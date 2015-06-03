#!/usr/bin/env node

var AWS  = require('aws-sdk');
var argv = require('yargs').argv;
var wait = require('wait.for');

// setup AWS config
if (process.env.hasOwnProperty('AWS_DEFAULT_REGION')) {
  AWS.config.region = process.env.AWS_DEFAULT_REGION;
} else { 
  AWS.config.region = 'us-east-1';
}

var awsAccountId = process.env.AWS_ACCOUNT_ID;
var rds = new AWS.RDS();
var optDryRun = false;

function deleteRdsSnapshot(snapId, dryRun) {
  if (dryRun) {
    console.log('Would delete DB Snapshot ' + snapId);
  } else {
    wait.forMethod(rds, 'deleteDBSnapshot', {DBSnapshotIdentifier: snapId});
    console.log('Deleted DB Snapshot ' + snapId);
  }
}

function processRdsSnapshots(forceDelete, maxage, dryRun) {

  var snapshotData = wait.forMethod(rds, 'describeDBSnapshots', {SnapshotType: 'manual'});
  var snapshot;
  var i;
  var j;
  var listResourceParams;
  var resourceTagData;
  var tags;
  var deleteSnap = true;
  var tsNow = Date.now();
  if (!maxage) {
    // default to a max age of 7 days
    maxage = 7 * 24 * 3600 * 1000;
  }

  for (i = 0; i < snapshotData.DBSnapshots.length; i++) {
    snapshot = snapshotData.DBSnapshots[i];
    if (snapshot.Status === 'available') {
      if (!forceDelete) {
        if (tsNow - snapshot.SnapshotCreateTime.getTime() < maxage) {
          // Don't delete snapshots who's create time is less than maxage
          console.log('DB Snapshot ' + snapshot.DBSnapshotIdentifier + ' is too new ... keeping');
          deleteSnap = false;
        } else {
          // Look at Tags to see if it's marked to be kept
          //console.log('Looking up tags for ' + snapshot.DBSnapshotIdentifier);
          listResourceParams = {ResourceName: 'arn:aws:rds:us-east-1:' + awsAccountId + ':snapshot:' + snapshot.DBSnapshotIdentifier};
          resourceTagData = wait.forMethod(rds, 'listTagsForResource', listResourceParams);

          tags = resourceTagData.TagList;
          for (j = 0; j < tags.length; j++) {
            if (tags[j].Key === 'keep-resource' && tags[j].Value !== 'false') {
              console.log('Keeping DB Snapshot ' + snapshot.DBSnapshotIdentifier);
              deleteSnap = false;
            }
          }
        }
      }

      if (deleteSnap) {
        deleteRdsSnapshot(snapshot.DBSnapshotIdentifier, dryRun);
      }
    }
  }
}

if (argv.dryrun || argv.n) {
  optDryRun = true;
}

wait.launchFiber(processRdsSnapshots, false, 0, optDryRun);
