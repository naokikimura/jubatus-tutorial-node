#!/usr/bin/env node

var jubatus = require('jubatus-node-client')
  , client = jubatus.classifier.client
  , fs = require('fs')
  , util = require('util')
  , lazy = require('lazy')
  , async = require('async')
  , argv = require('argv')

var debug;
if (process.env.NODE_DEBUG && /tutorial/.test(process.env.NODE_DEBUG)) {
  debug = function(x) { console.error('TUTORIAL:', x); };
} else {
  debug = function() { };
}

function get_most_likely(estimate_results) {
    return estimate_results.reduce(function(previous, current) {
        return previous[1] > current[1] ? previous : current;
    }, [, Number.NaN])
}

var options = [
        { name: 'server_ip', short: 's', type: 'string', description: 'server_ip' }
      , { name: 'server_port', short: 'p', type: 'int', description: 'server_port' }
      , { name: 'name', short: 'n', type: 'string', description: 'name' }
    ]
  , args = argv.option([options]).run();

debug(args)

var host = args.options.server_ip
  , port = args.options.server_port
  , name = args.options.name || 'tutorial'
  , concurrency = 10

var classifier = new client.Classifier(port, host)

async.series([
    function(callback) {
        classifier.get_config([name], function(error, result) {
            debug(result)
            callback(error)
        })
    }
  , function(callback) {
        classifier.get_status([name], function(error, result) {
            debug(result)
            callback(error)
        })
    }
  , function(callback) {
        var q = async.queue(function(task, callback) {
            fs.readFile(task.file, function(error, buffer) {
                if (error) throw error;

                var message = buffer.toString()
                  , datum = [[ ['message', message] ], []]
                  , data =[ [task.label, datum] ]
                classifier.train([name, data], callback);
            })
        }, concurrency)
        q.drain = function() {
            debug('train end')
            callback(null)
        }
        var is = fs.createReadStream('train.dat').on('open', function() {
            debug('train start')
        })
        lazy(is).lines.forEach(function(line) {
            var row = line.toString().split(/,/)
              , task = { label: row.shift(), file: row.shift() }
            q.push(task)
        })
    }
  , function(callback) {
        classifier.get_status([name], function(error, result) {
            debug(result)
            callback(error)
        })
    }
  , function(callback) {
        classifier.save([name, 'tutorial'], function(error, result) {
            debug(result)
            callback(error)
        })
    }
  , function(callback) {
        classifier.load([name, 'tutorial'], function(error, result) {
            debug(result)
            callback(error)
        })
    }
  , function(callback) {
        classifier.get_config([name], function(error, result) {
            debug(result)
            callback(error)
        })
    }
  , function(callback) {
        var q = async.queue(function(task, callback) {
            fs.readFile(task.file, function(error, buffer) {
                if (error) throw error;

                var message = buffer.toString()
                  , datum = [[ ['message', message] ], []]
                  , data =[ datum ]
               classifier.classify([name, data], callback);
            })
        }, 3)
        q.drain = function() {
            debug('classify end')
            callback(null)
        }
        var is = fs.createReadStream('test.dat').on('open', function() {
            debug('classify start')
        })
        lazy(is).lines.forEach(function(line) {
            var row = line.toString().split(/,/)
              , task = { label: row.shift(), file: row.shift() }
            q.push(task, function(error, resultset) {
                resultset.forEach(function(estimate_results) {
                    var estimate_result = get_most_likely(estimate_results)
                      , result = estimate_result[0] === task.label ? 'OK' : 'NG'
                    console.info('%s,%s,%s,%d', result, task.label, estimate_result[0], estimate_result[1]);
                })
            })
        })
    }
], function(error) {
    classifier.close();
})
