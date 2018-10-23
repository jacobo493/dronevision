const uuid = require('uuid/v4');
const DBRequest = require('tedious').Request;
const TYPES = require('tedious').TYPES;
const https = require('https');

const CONFIG = '{ "points": [] }';

module.exports = function (app, db, ai) {
    console.log('Adding routes');
    app.get('/api/v1/device', (req, res) => {
        loadDeviceList(db, res);
    });
    app.get('/api/v1/storage', (req, res) => {
        loadStorageList(db, res);
    });
    app.get('/api/v1/storage/:storageId/configuration', (req, res) => {
        loadConfiguration(db, req, res);
    });
    app.post('/api/v1/run', (req, res) => {
        fetchInventoryId(db, req, res);
        //createRun(db, req, res);
    });
    app.patch('/api/v1/run/:runId', (req, res) => {
        updateRun(db, req, res);
    });
    app.get('/api/v1/run/:runId/control', (req, res) => {
        controlRun(db, req, res);
    });
    app.post('/api/v1/run/:runId/control', (req, res) => {
        var runId = req.params.runId;
        console.log('received state from device for run ' + runId);
        res.sendStatus(200);
    });
    app.get('/api/v1/run/:runId/data', (req, res) => {
        getImageNamesForRun(db, req, res);
    });
    app.post('/api/v1/run/:runId/data', (req, res) => {
        createImage(db, req, res);
    });

    loadDeviceList = function (db, res) {
        var response = new Array();
        var request = new DBRequest(
            "SELECT * FROM device",
            function (err, rowCount, rows) {
                console.log(rowCount + ' row(s) returned');
                console.log(`response: ${response}`);
                res.send(response);
            }
        );

        request.on('row', function (columns) {
            var d = {}
            columns.forEach(function (column) {
                console.log("%s\t%s", column.metadata.colName, column.value);
                d[column.metadata.colName] = column.value;
            });
            response.push(d);
        });
        db.execSql(request);
    };

    loadStorageList = function (db, res) {
        var response = new Array();
        var request = new DBRequest(
            "SELECT * FROM storage",
            function (err, rowCount, rows) {
                console.log(rowCount + ' row(s) returned');
                console.log(`response: ${response}`);
                res.send(response);
            }
        );

        request.on('row', function (columns) {
            var d = {}
            columns.forEach(function (column) {
                console.log("%s\t%s", column.metadata.colName, column.value);
                d[column.metadata.colName] = column.value;
            });
            response.push(d);
        });
        db.execSql(request);
    };

    loadConfiguration = function (db, req, res) {
        var response = new Array();
        var deviceId = req.query.device_id;
        var storageId = req.params.storageId
        console.log('sending configuration for device ' + deviceId);
        var request = new DBRequest(
            "SELECT id, data FROM configuration WHERE device_id = @deviceId AND storage_id = @storageId",
            function (err, rowCount, rows) {
                console.log(rowCount + ' row(s) returned');
                console.log(`response: ${response}`);
                res.send(response);
            }
        );
        request.addParameter('deviceId', TYPES.UniqueIdentifier, deviceId);
        request.addParameter('storageId', TYPES.UniqueIdentifier, storageId);

        request.on('row', function (columns) {
            var d = {}
            columns.forEach(function (column) {
                console.log("%s\t%s", column.metadata.colName, column.value);
                if (column.metadata.colName == 'data') {
                    d['data'] = JSON.parse(column.value);
                } else {
                    d[column.metadata.colName] = column.value;
                }
            });
            response.push(d);
        });
        db.execSql(request);
    };

    fetchInventoryId = function (db, req, res) {
        var host = process.env.BC_HOST;
        var path = encodeURI(process.env.BC_PATH);
        var user = process.env.BC_USER;
        var passwd = process.env.BC_PASSWD;
        var auth = Buffer.from(`${user}:${passwd}`).toString('base64');
        var options = {
            hostname: host,
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${auth}`
            }
        };

        var request = https.request(options, (response) => {
            console.log(`Received inventory id response, status: ${response.statusCode}`);
            var id;
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                id = JSON.parse(chunk).value[0].No;
                console.log(`inventory id for run: ${id}`);
                createRun(db, req, res, id);
            });
            response.on('end', () => {
                console.log('No more data in response.');
            });
            if (response.statusCode == 200) {
                console.log('success');
            }
        });
        request.on('error', (e) => {
            console.error(`problem with request: ${e.message}`);
        });

        request.end();

    }

    createRun = function (db, req, res, inventoryId) {
        var runId = uuid();
        var deviceId = req.body.device_id;
        var storageId = req.body.storage_id
        var configurationId = req.body.configuration_id;
        console.log(`creating new run with id ${runId} for inventory id ${inventoryId}`);
        var request = new DBRequest(
            "INSERT INTO run(id, storage_id, device_id, configuration_id, started_at, inventory_id) VALUES (@id, @sid, @did, @cid, @dt, @iid)",
            function (err) {
                if (err) {
                    console.log(`received error ${err}`);
                    res.sendStatus(500);
                } else {
                    console.log(`created new run, response: ${runId}`);
                    res.send(runId);
                }
            }
        );
        request.addParameter('id', TYPES.UniqueIdentifier, runId);
        request.addParameter('did', TYPES.UniqueIdentifier, deviceId);
        request.addParameter('sid', TYPES.UniqueIdentifier, storageId);
        request.addParameter('cid', TYPES.UniqueIdentifier, configurationId);
        request.addParameter('dt', TYPES.DateTime, new Date());
        request.addParameter('iid', TYPES.Int, inventoryId);

        db.execSql(request);
    };

    updateRun = function (db, req, res) {
        var runId = req.params.runId;
        var command = req.body.command;
        console.log(`received ${command} command for run ${runId}`);
        if (command == 'stop') {
            var request = new DBRequest(
                "Update run SET finished_at = @dt WHERE id = @rid",
                function (err) {
                    if (err) {
                        console.log(`received error ${err}`);
                        res.sendStatus(500);
                    } else {
                        console.log(`finished run ${runId}`);
                        res.sendStatus(200);
                    }
                }
            );
            request.addParameter('rid', TYPES.UniqueIdentifier, runId);
            request.addParameter('dt', TYPES.DateTime, new Date());

            db.execSql(request);
        } else {
            res.sendStatus(400);
        }
    };

    controlRun = function (db, req, res) {
        var runId = req.params.runId;
        console.log('sending control command for run ' + runId);
        res.send('continue');
    };

    getImageNamesForRun = function (db, req, res) {
        var response = new Array();
        var runId = req.params.runId;
        console.log('sending sequence state to device for run ' + runId);
        var request = new DBRequest(
            "SELECT name FROM image WHERE run_id = @rid",
            function (err, rowCount, rows) {
                if (err) {
                    console.log(`received error ${err}`);
                    res.sendStatus(500);
                } else {
                    console.log(rowCount + ' row(s) returned');
                    console.log(`response: ${response}`);
                    res.send(response);
                }
            }
        );
        request.addParameter('rid', TYPES.UniqueIdentifier, runId);

        request.on('row', function (columns) {
            columns.forEach(function (column) {
                console.log("%s\t%s", column.metadata.colName, column.value);
                response.push(column.value);
            });

        });
        db.execSql(request);
    }

    createImage = function (db, req, res) {
        var imageId = uuid();
        var runId = req.params.runId;
        var name = req.body.name;
        var mimetype = req.body.mimetype;
        var data = req.body.data;
        console.log('creating new image for run id ' + runId);
        var request = new DBRequest(
            "INSERT INTO image(id, run_id, name, mimetype, data) VALUES (@id, @rid, @name, @mime, @data)",
            function (err) {
                if (err) {
                    console.log(`received error ${err}`);
                    res.sendStatus(500);
                } else {
                    console.log("created new image");
                    res.sendStatus(200);
                }
            }
        );
        request.addParameter('id', TYPES.UniqueIdentifier, imageId);
        request.addParameter('rid', TYPES.UniqueIdentifier, runId);
        request.addParameter('name', TYPES.VarChar, name);
        request.addParameter('mime', TYPES.VarChar, mimetype);
        request.addParameter('data', TYPES.Text, data);

        db.execSql(request);
    };

};