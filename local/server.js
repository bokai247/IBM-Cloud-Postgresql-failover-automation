/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";
/* jshint node:true */

// Add the express web framework
const express = require("express");
const app = express();
const fs = require("fs");

// Use body-parser to handle the PUT data
const bodyParser = require("body-parser");
app.use(
        bodyParser.urlencoded({
extended: false
})
        );

// Util is handy to have around, so thats why that's here.
const util = require('util')

// and so is assert
const assert = require('assert');

// We want to extract the port to publish our app on
let port = process.env.PORT || 8080;

// Then we'll pull in the database client library
const pg = require("pg");

// Now lets get cfenv and ask it to parse the environment variable
let cfenv = require('cfenv');

// load local VCAP configuration  and service credentials
let vcapLocal;
try {
    vcapLocal = require('./vcap-local.json');
    console.log("Loaded local VCAP");
} catch (e) {
    // console.log(e)
}
let vcapLocalReplica;
try {
    vcapLocalReplica = require('./vcap-local-replica.json');
    console.log("Loaded local VCAP replica");
} catch (e) {
    // console.log(e)
}

const appEnvOpts = vcapLocal ? { vcap: vcapLocal} : {}
const appEnvOpts2 = vcapLocalReplica ? { vcap: vcapLocalReplica} : {}
const appEnv = cfenv.getAppEnv(appEnvOpts);
const appEnv2 = cfenv.getAppEnv(appEnvOpts2);
// Within the application environment (appenv) there's a services object
let services = appEnv.services;
let services2 = appEnv2.services;

// The services object is a map named by service so we extract the one for PostgreSQL
var pg_services = services["databases-for-postgresql"];
var pg_services2 = services2["databases-for-postgresql"];
// This check ensures there is a services for PostgreSQL databases
assert(!util.isUndefined(pg_services), "Must be bound to databases-for-postgresql services");
assert(!util.isUndefined(pg_services2), "Must be bound to databases-for-postgresql services");
// We now take the first bound PostgreSQL service and extract it's credentials object
var credentials = pg_services[0].credentials;
var credentials2 = pg_services2[0].credentials;
var postgresconn = credentials.connection.postgres;
var postgresconn2 = credentials2.connection.postgres;

let caCert = new Buffer.from(postgresconn.certificate.certificate_base64, 'base64').toString();
let caCert2 = new Buffer.from(postgresconn2.certificate.certificate_base64, 'base64').toString();

let connectionString = postgresconn.composed[0];
let connectionString2 = postgresconn2.composed[0];

// set up a new client using our config details
let client = new pg.Client({ connectionString: connectionString,
ssl: {
ca: caCert
}
});

client.connect(function(err) {
    if (err) {
        console.log(err);
        console.log("Failed to establish connection to primary db instance, reconnecting to replica...")
        client = new pg.Client({ connectionString: connectionString2,
        ssl: {
        ca: caCert2
        }
        });
        client.connect(function(err) {
            if (err) {
                console.log(err);
                process.exit(1);
            }else{
                console.log("connected to replica instance, note: this replica is read-only")
            }
        });
    } else {
        client.query(
                     "CREATE TABLE IF NOT EXISTS words (word varchar(256) NOT NULL, definition varchar(256) NOT NULL)",
                     function(err, result) {
            if (err) {
                console.log(err);
            }
        }
                     );
    }
});

// Add a word to the database
function addWord(word, definition) {
    return new Promise(function(resolve, reject) {
        let queryText = "INSERT INTO words(word,definition) VALUES($1, $2)";
        client.query(
                     queryText, [word, definition],
                     function(error, result) {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        }
                     );
    });
}

// Get words from the database
function getWords() {
    return new Promise(function(resolve, reject) {
        client.query("SELECT * FROM words ORDER BY word ASC", function(
                                                                       err,
                                                                       result
                                                                       ) {
            if (err) {
                reject(err);
            } else {
                resolve(result.rows);
            }
        });
    });
}

// We can now set up our web server. First up we set it to serve static pages
app.use(express.static(__dirname + "/public"));

// The user has clicked submit to add a word and definition to the database
// Send the data to the addWord function and send a response if successful
app.put("/words", function(request, response) {
    addWord(request.body.word, request.body.definition)
    .then(function(resp) {
        response.send(resp);
    })
    .catch(function(err) {
        console.log(err);
        response.status(500).send(err);
    });
});

// Read from the database when the page is loaded or after a word is successfully added
// Use the getWords function to get a list of words and definitions from the database
app.get("/words", function(request, response) {
    getWords()
    .then(function(words) {
        response.send(words);
    })
    .catch(function(err) {
        console.log(err);
        response.status(500).send(err);
    });
});

// Listen for a connection.
app.listen(port, function() {
    console.log("Server is listening on port " + port);
});


app.get("/dbid", function (req, res) {
  res.send(credentials.instance_administration_api.instance_id)
})
