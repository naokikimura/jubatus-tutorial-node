#!/usr/bin/env node

var jubatus = require('jubatus-node-client'),
    client = jubatus.classifier.client,
    fs = require('fs'),
    util = require('util'),
    lazy = require('lazy'),
    async = require('async'),
    argv = require('argv');

var isDebugEnabled = process.env.NODE_DEBUG && /tutorial/.test(process.env.NODE_DEBUG),
    debug = isDebugEnabled ? function (x) { console.error('TUTORIAL:', x); } : function () {};

function getMostLikely(estimateResults) {
    return estimateResults.reduce(function (previous, current) {
        return previous[1] > current[1] ? previous : current;
    }, [null, NaN]);
}

var options = [
        { name: 'server_ip', 'short': 's', type: 'string', description: 'server_ip' },
        { name: 'server_port', 'short': 'p', type: 'int', description: 'server_port' },
        { name: 'name', 'short': 'n', type: 'string', description: 'name' }
    ],
    args = argv.option([options]).run();
debug(args);

var host = args.options.server_ip,
    port = args.options.server_port,
    name = args.options.name || 'tutorial',
    id = 'tutorial',
    concurrency = 10,
    classifier = new client.Classifier(port, host);

async.series([
    function (callback) {
        classifier.get_config(name, function (error, result) {
            debug(result);
            callback(error);
        });
    },
    function (callback) {
        classifier.get_status(name, function (error, result) {
            debug(result);
            callback(error);
        });
    },
    function (callback) {
        var worker = function (task, callback) {
                fs.readFile(task.file, function (error, buffer) {
                    if (error) {
                        callback(error);
                        return;
                    }

                    var message = buffer.toString(),
                        string_values = [ ['message', message] ],
                        num_values = [],
                        label = task.label,
                        datum = [string_values, num_values],
                        data = [ [label, datum] ];
                    classifier.train(name, data, callback);
                });
            },
            q = async.queue(worker, concurrency),
            stream = fs.createReadStream('train.dat')
                .on('open', function () {
                    debug('train start');
                })
                .on('close', function () {
                    debug('stream closed');
                    var running = q.running(),
                        length = q.length(),
                        drains = (running + length) === 0,
                        finish = function () {
                            debug('train end');
                            callback(null);
                        };
                    debug({ running: running, length: length, drains: drains });
                    if (drains) {
                        finish();
                    } else {
                        q.drain = function () {
                            debug('drained');
                            finish();
                        };
                    }
                });
        q.drain = function () {
            debug('drained');
        };
        lazy(stream)
            .lines
            .filter(function (buffer) { return buffer; })
            .map(function (buffer) {
                return buffer.toString();
            })
            .forEach(function (line) {
                var row = line.split(/,/),
                    task = { label: row.shift(), file: row.shift() };
                q.push(task);
            });
    },
    function (callback) {
        classifier.get_status(name, function (error, result) {
            debug(result);
            callback(error);
        });
    },
    function (callback) {
        classifier.save(name, id, function (error, result) {
            debug(result);
            callback(error);
        });
    },
    function (callback) {
        classifier.load(name, id, function (error, result) {
            debug(result);
            callback(error);
        });
    },
    function (callback) {
        classifier.get_config(name, function (error, result) {
            debug(result);
            callback(error);
        });
    },
    function (callback) {
        var worker = function (task, callback) {
                fs.readFile(task.file, function (error, buffer) {
                    if (error) {
                        callback(error);
                        return;
                    }
                    var message = buffer.toString(),
                        string_values = [ ['message', message] ],
                        num_values = [],
                        label = task.label,
                        datum = [string_values, num_values],
                        data = [ datum ];
                    classifier.classify(name, data, function (error, resultset) {
                        if (error) {
                            callback(error);
                            return;
                        }
                        resultset.forEach(function (estimates) {
                            var estimate = getMostLikely(estimates),
                                result = estimate[0] === label ? 'OK' : 'NG';
                            console.info('%s,%s,%s,%d', result, label, estimate[0], estimate[1]);
                        });
                        callback(null);
                    });
                });
            },
            q = async.queue(worker, concurrency),
            stream = fs.createReadStream('test.dat')
                .on('open', function () {
                    debug('classify start');
                })
                .on('close', function () {
                    debug('stream closed');
                    var running = q.running(),
                        length = q.length(),
                        drains = (running + length) === 0,
                        finish = function () {
                            debug('classify end');
                            callback(null);
                        };
                    debug({ running: running, length: length, drains: drains });
                    if (drains) {
                        finish();
                    } else {
                        q.drain = function () {
                            debug('drained');
                            finish();
                        };
                    }
                });
        q.drain = function () {
            debug('drained');
        };
        lazy(stream)
            .lines
            .filter(function (buffer) { return buffer; })
            .map(function (buffer) { return buffer.toString(); })
            .forEach(function (line) {
                var row = line.split(/,/),
                    task = { label: row.shift(), file: row.shift() };
                q.push(task);
            });
    }
], function (error) {
    if (error) {
        console.error(error.stack || error);
        process.exit(1);
    }
    classifier.get_client().close();
});
