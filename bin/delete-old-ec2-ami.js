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
var autoscaling = new AWS.AutoScaling();
var ec2 = new AWS.EC2();
var optDryRun = false;

function getAllLaunchConfigs(callback) {

  var describeLaunchConfigs = function (lcList, nextToken, cb) {
    autoscaling.describeLaunchConfigurations({NextToken: nextToken}, function(err, data) {
      var i;
      var launchConfigs;
      if (err) {
        cb(err);
      } else {
        launchConfigs = data.LaunchConfigurations;
        for (i = 0; i < launchConfigs.length; i++) {
          lcList.push(launchConfigs[i]);
        }
        if (data.NextToken) {
          describeLaunchConfigs(lcList, data.NextToken, cb);
        } else {
          cb(err, lcList);
        }
      }
    });
  };

  describeLaunchConfigs([], undefined, callback);
}

function getAllInstances(callback) {

  var describeInstances = function (instanceList, nextToken, cb) {
    ec2.describeInstances({NextToken: nextToken}, function(err, data) {
      var reservations;
      var i;
      var j;
      if (err) {
        cb(err);
      } else {
        reservations = data.Reservations;
        for (i = 0; i < reservations.length; i++) {
          for (j = 0; j < reservations[i].Instances.length; j++) {
            instanceList.push(reservations[i].Instances[j]);
          }
        }
        if (data.NextToken) {
          describeInstances(instanceList, data.NextToken, cb);
        } else {
          cb(err, instanceList);
        }
      }
    });
  };

  describeInstances([], undefined, callback);
}

function getActiveAmis(callback) {

  getAllLaunchConfigs(function(err, lcData) {
    if (err) {
      callback(err, []);
    } else {

      getAllInstances(function (err, iData) {
        var amiSeen = {};
        var i;
        if (err) {
          callback(err, []);
        } else {

          for (i = 0; i < lcData.length; i++) {
            if (amiSeen.hasOwnProperty(lcData[i].ImageId) ) {
              amiSeen[lcData[i].ImageId]++;
            } else {
              amiSeen[lcData[i].ImageId] = 1;
            }
          }
          for (i = 0; i < iData.length; i++) {
            if (amiSeen.hasOwnProperty(iData[i].ImageId) ) {
              amiSeen[iData[i].ImageId]++;
            } else {
              amiSeen[iData[i].ImageId] = 1;
            }
          }

          callback(err, amiSeen);
        }
      });
    }
  });
}

function getMyAmis(callback) {

  var describeImages = function (amiList, cb) {
    ec2.describeImages({Owners: ['self'], Filters: [{ Name: 'state', Values: ['available'] }]}, function(err, data) {
      var i;
      if (err) {
        cb(err);
      } else {
        for (i = 0; i < data.Images.length; i++) {
          amiList.push(data.Images[i]);
        }
        cb(err, amiList);
      }
    });
  };

  describeImages([], callback);
}

function processEc2Amis(forceDelete, maxage, dryRun) {

  var activeAmis = wait.for(getActiveAmis);
  var myAmis = wait.for(getMyAmis);
  var deleteAmi = true;
  var ami;
  var amiDate;
  var i;
  var j;
  var tags;
  var tsNow = Date.now();

  if (!maxage) {
    // default to a max age of 7 days
    maxage = 7 * 24 * 3600 * 1000;
  }

  for (i = 0; i < myAmis.length; i++) {
    ami = myAmis[i];

    if (!forceDelete) {
      amiDate = new Date(ami.CreationDate);
      if (tsNow - amiDate.getTime() < maxage) {
        // Don't delete AMIs who's create time is less than maxage
        console.log('AMI ' + ami.ImageId + ' is too new ... keeping');
        deleteAmi = false;
      } else if (activeAmis.hasOwnProperty(ami.ImageId)) {
        console.log('AMI ' + ami.ImageId + ' is used by active LaunchConfig and/or Instance ... keeping');
      } else {
        // Look at Tags to see if it's marked to be kept
        tags = ami.Tags;
        for (j = 0; j < tags.length; j++) {
          if (tags[j].Key === 'keep-resource' && tags[j].Value !== 'false') {
            console.log('Keeping AMI ' + ami.ImageId);
            deleteAmi = false;
          }
        }
      }
    }

    if (deleteAmi) {
      if (dryRun) {
        console.log('Would delete AMI ' + ami.ImageId + dryRun);
      } else {
        wait.forMethod(ec2, 'deregisterImage', {ImageId: ami.ImageId});
        console.log('Deregister AMI ' + ami.ImageId + dryRun);
      }
    }
  }
}

if (argv.dryrun || argv.n) {
  optDryRun = true;
}

wait.launchFiber(processEc2Amis, false, 0, optDryRun);
