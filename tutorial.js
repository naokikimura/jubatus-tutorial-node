#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');
const util = require('util');
const jubatus = require('jubatus');
const minimist = require('minimist');

const debug = util.debuglog('jubatus-tutorial-node');
const enabled = debug.toString() !== (function () {}).toString();
Object.defineProperty(debug, 'enabled', { get() { return enabled; } });

const args = minimist(process.argv.slice(2), { default: { p: 9199, h: 'localhost', n: '', t: 0 } });
debug(args);

const { p: port, h: host, n: name, t: timeout } = args,
    classifier = new jubatus.classifier.client.Classifier(port, host, name, timeout);

classifier.getConfig().then(result => {
    debug(result);

    return classifier.getStatus();
}).then(result => {
    debug(result);

    // train

    const results = [];
    return new Promise((resolve, reject) => {
        readline.createInterface({ input: fs.createReadStream('train.dat') })
        .on('line', line => {
            debug(line);

            const [ label, file ] = line.split(/,/, 2);
            fs.readFile(file, (error, buffer) => {
                if (error) {
                    reject(error);
                } else {
                    const message = buffer.toString();
                    const stringValues = [ [ 'message', message ] ];
                    const datum = [ stringValues ];
                    const labeledDatum = [ label, datum ];
                    const data = [ labeledDatum ];
                    results.push(classifier.train(data));
                }
            });
        })
        .on('close', () => {
            resolve(Promise.all(results));
        });
    });
}).then(responses => {
    const count = responses.map(([ result, msgid ]) => result).reduce((accumulator, current) => accumulator + current);
    debug(`train result: ${ count }`);

    // classify

    const results = [];
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream('test.dat');
        readline.createInterface({ input: stream })
        .on('line', line => {
            debug(line);

            const [ label, file ] = line.split(/,/, 2);
            fs.readFile(file, (error, buffer) => {
                if (error) {
                    reject(error);
                } else {
                    const message = buffer.toString();
                    const data = [ [ [ [ 'message', message ] ] ] ];
                    const promise = classifier.classify(data).then(response => {
                        debug(response);
                        const [ result, msgid ] = response;
                        return result.map(estimates => {
                            const mostLikely = estimates
                                .map(([ label, score ]) => ({ label, score }))
                                .reduce((accumulator, current) => current.score > accumulator.score ? current : accumulator);
                            return ({ label, mostLikely, valid : mostLikely.label === label });
                        });
                    });
                    results.push(promise);
                }
            });
        })
        .on('close', () => {
            resolve(Promise.all(results));
        });
    });
}).then(results => {
    debug(results);

    results.forEach(result => {
        console.log(JSON.stringify(result));
    });

    classifier.getClient().close();
    process.exit(0);
}).catch(error => {
    console.error(error);
    classifier.getClient().close();
    process.exit(1);
});