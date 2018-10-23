const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const routes = require('./routes');
const DBConnection = require('tedious').Connection;
const DBRequest = require('tedious').Request;
const TYPES = require('tedious').TYPES;
const https = require('https');

const port = process.env.PORT || 3000;
const username = process.env.DB_USER;
const password = process.env.DB_PASSWD;
const databaseHost = process.env.DB_HOST;
const databaseName = process.env.DB_NAME;
const customVisionHost = process.env.CV_HOST;
const customVisionAccessToken = process.env.CV_ACCESS_TOKEN;

dbConnection = createDatabaseConnection();

app.use(bodyParser.json({ limit: '10mb' }));

routes(app, dbConnection, {});

app.listen(port, () => {
    console.log('We are live on ' + port);
    startImageUpload();
});

function createDatabaseConnection() {
    var config = {
        userName: username,
        password: password,
        server: databaseHost,
        options: {
            database: databaseName,
            encrypt: true
        }
    }
    var conn = new DBConnection(config);
    conn.on('connect', function (err) {
        if (err) {
            console.log(err);
        } else {
            console.log('Database connection established');
        }
    });
    return conn;
}

function startImageUpload() {
    console.log("scheduling image upload");
    setTimeout(loadPendingImages, 3000000);
}

async function loadPendingImages() {
    console.log("Starting image upload");
    var request = new DBRequest(
        "SELECT i.data, r.inventory_id FROM image AS i INNER JOIN run AS r ON i.run_id = r.id WHERE processed_at IS NULL",
        function (err, rowCount, rows) {
            console.log(rowCount + ' pending image(s) returned');
            startImageUpload();
        }
    );

    request.on('row', function (columns) {
        d = {};
        columns.forEach(function (column) {
            d[column.metadata.colName] = column.value;
        });
        pushImage(d);
    });
    dbConnection.execSql(request);

}

function pushImage(data) {
    var coords = data.name.match(/x([0-9]*)_y([0-9]*)/);
    var xPos = 0;
    var yPos = 0;
    if (coords !== null) {
        xPos = coords.length >= 2 ? coords[1] : 0;
        yPos = coords.length >= 3 ? coords[2] : 0;
    }
    var postData = JSON.stringify({
        'file': data.data,
        'inventory_id': 2,
        'xPosition': xPos,
        'yPosition': yPos
    });
    //console.log(postData);
    const options = {
        hostname: customVisionHost,
        port: 443,
        path: '/api/ClassifyImage?code=' + customVisionAccessToken,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(options, (res) => {
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            console.log(`BODY: ${chunk}`);
        });
        res.on('end', () => {
            console.log('No more data in response.');
        });
        if (res.statusCode == 200) {
            markImageProcessed(data.id);
        }
    });
    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });

    // write data to request body
    req.write(postData);
    req.end();
}

function markImageProcessed(id) {
    var request = new DBRequest(
        "Update image SET processed_at = @dt WHERE id = @id",
        function (err) {
            if (err) {
                console.log(`received error ${err}`);
            }
            console.log(`processed image ${id}`);
        }
    );
    request.addParameter('id', TYPES.UniqueIdentifier, id);
    request.addParameter('dt', TYPES.DateTime, new Date());

    dbConnection.execSql(request);
}