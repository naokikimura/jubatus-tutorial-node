#!/usr/bin/env node

var msgpack = require('msgpack')
  , net = require('net')
  , fs = require('fs')
  , util = require('util')
  , lazy = require('lazy')
  , async = require('async')

var debug;
if (process.env.NODE_DEBUG && /tutorial/.test(process.env.NODE_DEBUG)) {
  debug = function(x) { console.error('TUTORIAL:', x); };
} else {
  debug = function() { };
}

function get_most_likely(estimate_results) {
    return estimate_results.reduce(function(previous, current) {
        return previous[1] > current[1] ? previous : current;
    })
}

var msgid_gen = (function() {
    var MAX = Math.pow(2, 32) -1
      , msgid = 0;
    return {
        next: function() {
            return (msgid = (msgid < MAX ? msgid + 1 : 0))
        }
    }
})()

var createClient = function(port, host) {
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

var host = 'localhost'
  , port = 9199
  , name = 'tutorial'

var client = createClient(port, host)

async.series([
    function(callback) {
        client.call('get_config', [name], callback);
    }
  , function(callback) {
        client.call('get_status', [name], callback)
    }
  , function(callback) {
        var is = fs.createReadStream('train.dat').on('open', function() {
            debug('train start')
        }).on('end', function() {
            debug('train end')
            callback(null)
        })
        lazy(is).lines.map(function(line) {
            var row = line.toString().split(/,/)
              , label = row[0]
              , file = row[1]
              , message = fs.readFileSync(file).toString()
              , datum = [[ ["message", message ] ], []]
            return [ [label, datum] ]
        }).forEach(function(data) {
            client.call('train', [name, data]);
            client.call('get_status', [name])
        })
    }
  , function(callback) {
        client.call('save', [name, 'tutorial'], callback)
    }
  , function(callback) {
        client.call('load', [name, 'tutorial'], callback)
    }
  , function(callback) {
        client.call('get_status', [name], callback)
    }
  , function(callback) {
        var is = fs.createReadStream('test.dat').on('open', function() {
            debug('classify start')
        }).on('end', function() {
            debug('classify end')
            callback(null)
        })
        lazy(is).lines.map(function(line) {
            var row = line.toString().split(/,/)
              , label = row[0]
              , file = row[1]
              , message = fs.readFileSync(file).toString()
              , datum = [[ ["message", message ] ], []]
            return { label: label, datum: datum }
        }).forEach(function(o) {
            var label = o.label
              , data = [ o.datum ]
            client.call('classify', [name, data], function(error, resultset) {
                resultset.forEach(function(estimate_results) {
                    var estimate_result = get_most_likely(estimate_results)
                      , result = estimate_result[0] === label ? 'OK' : 'NG'
                    console.info('%s,%s,%s,%d', result, label, estimate_result[0], estimate_result[1]);
                })
            });
        })
    }
], function(error) {
    client.close();
})
