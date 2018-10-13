var xtend = require('xtend');
var jwt = require('jsonwebtoken');
var UnauthorizedError = require('./UnauthorizedError');

function noQsMethod(options) {
  var defaults = { required: true };
  options = xtend(defaults, options);
  console.log('MHA', 'noQS')

  return function (socket) {
    var server = this.server || socket.server;


    console.log('MHA', 'auth return function start')
    if (!server.$emit) {
      //then is socket.io 1.0
      var Namespace = Object.getPrototypeOf(server.sockets).constructor;
      if (!~Namespace.events.indexOf('authenticated')) {
        Namespace.events.push('authenticated');
      }
    }

    if(options.required){
      var auth_timeout = setTimeout(function () {
        socket.disconnect('unauthorized');
      }, options.timeout || 5000);
    }

    socket.on('authenticate', function (data) {
      console.log('MHA', 'on authenticate', data, options)
      var _auth_timeout = auth_timeout;
      if(options.required){
        console.log('clearing to')
        clearTimeout(auth_timeout);
      }
      // error handler
      var onError = function(err, code) {
          if (err) {
            code = code || 'unknown';
            var error = new UnauthorizedError(code, {
              message: (Object.prototype.toString.call(err) === '[object Object]' && err.message) ? err.message : err
            });
            var callback_timeout;
            // If callback explicitely set to false, start timeout to disconnect socket 
            if (options.callback === false || typeof options.callback === "number") {
              if (typeof options.callback === "number") {
                if (options.callback < 0) {
                  // If callback is negative(invalid value), make it positive
                  options.callback = Math.abs(options.callback);
                }
              }
              callback_timeout = setTimeout(function () {
                socket.disconnect('unauthorized');
              }, (options.callback === false ? 0 : options.callback));
            }
            socket.emit('unauthorized', error, function() {
              if (typeof options.callback === "number") {
                clearTimeout(callback_timeout);
              }
              socket.disconnect('unauthorized');
            });
            return; // stop logic, socket will be close on next tick
          }
      };

      if(!data || typeof data.token !== "string") {
        return onError({message: 'invalid token datatype'}, 'invalid_token');
      }

      var onJwtVerificationReady = function(err, decoded) {

        if (err) {
          return onError(err, 'invalid_token');
        }

        // success handler
        var onSuccess = function() {
          clearTimeout(auth_timeout);
          socket[options.decodedPropertyName] = decoded;
          socket.emit('authenticated');
          if (server.$emit) {
            server.$emit('authenticated', socket);
          } else {
            //try getting the current namespace otherwise fallback to all sockets.
            var namespace = (server.nsps && socket.nsp &&
                             server.nsps[socket.nsp.name]) ||
                            server.sockets;

            // explicit namespace
            namespace.emit('authenticated', socket);
          }
        };

        if(options.additional_auth && typeof options.additional_auth === 'function') {
          options.additional_auth(decoded, onSuccess, onError);
        } else {
          onSuccess();
        }
      };

      var onSecretReady = function(err, secret) {
        if (err || !secret) {
          return onError(err, 'invalid_secret');
        }
        console.log(data.token)
        var options = {
          ignoreExpiration: true,
          algorithms: ["HS256"]
        };
        jwt.verify(data.token, secret, options, onJwtVerificationReady);
      };

      getSecret(socket.request, options.secret, data.token, onSecretReady);
    });
  };
}

function authorize(options, onConnection) {
  options = xtend({ decodedPropertyName: 'decoded_token' }, options);
  console.log('MHA', 'socketio jwt authorize')

    return noQsMethod(options);

}

function getSecret(request, secret, token, callback) {
  if (typeof secret === 'function') {
    if (!token) {
      return callback({ code: 'invalid_token', message: 'jwt must be provided' });
    }

    var parts = token.split('.');

    if (parts.length < 3) {
      return callback({ code: 'invalid_token', message: 'jwt malformed' });
    }

    if (parts[2].trim() === '') {
      return callback({ code: 'invalid_token', message: 'jwt signature is required' });
    }
    var decodedToken = jwt.decode(token);

    if (!decodedToken) {
      return callback({ code: 'invalid_token', message: 'jwt malformed' });
    }

    secret(request, decodedToken, callback);
  } else {
    callback(null, secret);
  }
};

exports.authorize = authorize;
