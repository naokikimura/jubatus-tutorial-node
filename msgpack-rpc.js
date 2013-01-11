var msgpack = require('msgpack')
  , net = require('net')
  , util = require('util')

var debug;
if (process.env.NODE_DEBUG && /msgpack-rpc/.test(process.env.NODE_DEBUG)) {
  debug = function(x) { console.error('MSGPACK-RPC:', x); };
} else {
  debug = function() { };
}

var msgid_gen = (function() {
    var MAX = Math.pow(2, 32) - 1
      , msgid = 0;
    return {
        next: function() {
            return (msgid = (msgid < MAX ? msgid + 1 : 0))
        }
    }
})()

exports.createClient = function(port, host) {
    debug(util.format('{ "port": "%d", "host": "%s"}', port, host))
    var socket = net.createConnection((port || 9199), (host || 'localhost'), function() {
            debug('conneted');
        }).on('end', function() {
            debug('disconnected');
        })
      , stream = new msgpack.Stream(socket).on('msg', function(response) {
            debug('received message: ' + util.inspect(response, false, null, true));
            var type = response.shift()
              , msgid = response.shift()
              , error = response.shift()
              , result = response.shift()
              , callback = (callbacks[msgid] || function() {})
            callback(error, result, msgid)
            delete callbacks[msgid]
        })
      , callbacks = {}
    return {
        close: function() {
            socket.end();
        }
      , call: function(method, params, callback) {
            var msgid = msgid_gen.next()
            callbacks[msgid] = callback;
            stream.send([0, msgid, method, params]);
        }
    }
}
