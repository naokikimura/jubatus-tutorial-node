#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const jubatus = require('jubatus');
const minimist = require('minimist');
const bluebird = require('bluebird');
const _ = require('lodash');
const { common: { types: { Datum } }, classifier: { types: { LabeledDatum }, client: { Classifier } } } = jubatus;

const debug = util.debuglog('jubatus-tutorial-node');

const args = minimist(process.argv.slice(2), { default: { p: 9199, h: 'localhost', n: '', t: 0, c: 10 } });
debug('%o', args);

const { p: port, h: host, n: name, t: timeout, c: concurrency } = args;
const classifier = new Classifier(port, host, name, timeout);

const readFile = bluebird.promisify(fs.readFile);
const list = (dirname) => {
    const readDir = bluebird.promisify(fs.readdir);
    const find = dirname => readDir(dirname).then(files => files.map(file => path.join(dirname, file)));
    const mapStat = (file, iteratee) =>
        new Promise((resolve, reject) => fs.stat(file, (error, stat) => error ? reject(error) : resolve(iteratee(stat, file))));
    const filterStat = (files, predicate) =>
        Promise.all(files.map(file => mapStat(file, (stat, file) => predicate(stat) && file))).then(files => files.filter(file => file));
    return find(dirname)
        .then(files => filterStat(files, stat => stat.isDirectory()))
        .then(directories => Promise.all(directories.map(directory => find(directory))))
        .then(files => filterStat(_.flatten(files), stat => stat.isFile()))
        .then(files => _.shuffle(files.map(file => ({ label: path.basename(path.dirname(file)), file }))));
};

classifier.clear().then(result => {
    debug('%o', result);
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
    debug('train results: %d', count);
    return list('20news-bydate-test');
}).then(labeledFiles =>
    // classify
    bluebird.map(labeledFiles, ({ label, file }) =>
        readFile(file).then(buffer => {
            return classifier.classify([new Datum().addString('message', buffer.toString())]).then(results => {
                return results.map(estimates => {
                    const mostLikely = _.maxBy(estimates, (estimate) => estimate.score);
                    return ({ label, mostLikely, valid: mostLikely.label === label });
                });
            });
        }), { concurrency })
).then(results => {
    debug('test results: %d', results.length);
    results.forEach(result => console.log(JSON.stringify(result)));
    process.exit(0);
}).catch(error => {
    console.error(error);
    process.exit(1);
});