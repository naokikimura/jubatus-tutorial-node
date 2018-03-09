#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const { common: { types: { Datum } }, classifier: { types: { LabeledDatum }, client: { Classifier } } } = require('jubatus');
const minimist = require('minimist');
const bluebird = require('bluebird');

const debug = util.debuglog('jubatus-tutorial-node');

const args = minimist(process.argv.slice(2), { default: { p: 9199, h: 'localhost', n: '', t: 0, c: 100 } });
debug(args);

const { p: port, h: host, n: name, t: timeout, c: concurrency } = args,
    classifier = new Classifier(port, host, name, timeout);

function promisify(fn) {
    return (...args) => new Promise((resolve, reject) =>
        fn.apply(null, args.concat((error, result) => error ? reject(error) : resolve(result))));
}

const readFile = promisify(fs.readFile);
const list = (dirname) => {
    const readDir = promisify(fs.readdir);
    const find = (dirname) => readDir(dirname).then(files => files.map(file => path.join(dirname, file)));
    const flatten = (array) => array.reduce((accumulator, current) => accumulator.concat(current));
    const mapStat = (file, iteratee) => 
        new Promise((resolve, reject) => fs.stat(file, (error, stat) => error ? reject(error) : resolve(iteratee(stat, file))));
    const filterStat = (files, predicate) => 
        Promise.all(files.map(file => mapStat(file, (stat) => predicate(stat) && file))).then(files => files.filter(file => file));
    return find(dirname)
        .then(files => filterStat(files, (stat) => stat.isDirectory))
        .then(directories => Promise.all(directories.map(directory => find(directory))))
        .then(files => filterStat(flatten(files), (stat) => stat.isFile))
        .then(files => files.map(file => ({ label: path.basename(path.dirname(file)), file })));
};

classifier.clear().then(result => {
    debug(result);
    return list('20news-bydate-train');
}).then(labeledFiles => 
    // train
    bluebird.map(labeledFiles, ({ label, file }) => 
        readFile(file).then(buffer => {
            const message = buffer.toString();
            const datum = new Datum().addString('message', message);
            const labeledDatum = new LabeledDatum(label, datum);
            const data = [labeledDatum];
            return classifier.train(data);
        }), { concurrency })
).then(results => {
    const count = results.reduce((accumulator, current) => accumulator + current);
    debug(`train result: ${count}`);
    return list('20news-bydate-test');
}).then(labeledFiles => 
    // classify
    bluebird.map(labeledFiles, ({ label, file }) => 
        readFile(file).then(buffer => {
            return classifier.classify([new Datum().addString('message', buffer.toString())]).then(result => {
                debug(result);
                return result.map(estimates => {
                    const mostLikely = estimates
                        .reduce((accumulator, current) => current.score > accumulator.score ? current : accumulator);
                    return ({ label, mostLikely, valid: mostLikely.label === label });
                });
            });
        }), { concurrency })
).then(results => {
    results.forEach(result => console.log(JSON.stringify(result)));
    process.exit(0);
}).catch(error => {
    console.error(error);
    process.exit(1);
});