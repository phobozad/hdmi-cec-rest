// https://scotch.io/tutorials/build-a-restful-api-using-node-and-express-4
//
// BASE SETUP
// ====================================================================

// Call needed packages
var express 	= require("express");
var app		= express();
var bodyParser	= require("body-parser");

// CEC Stuff
var nodecec	= require("node-cec");
var NodeCec	= nodecec.NodeCec;
var CEC		= nodecec.CEC;
var cec		= new NodeCec("node-cec-monitor");

// WOL Stuff
var wol		= require("wake_on_lan");

// Sony SOAP control stuff
var request	= require("request");
var Step	= require("step");

var portMapping =  {
	1:  0x1000,
	2:  0x2000,
	3:  0x3000,
	11: 0x1142,
	12: 0x1143,
	13: 0x1110,
	14: 0x1120,
	15: 0x1130,
	16: 0x1144 };


// Application API Variables
var hdmiInput	= 0;
var hdmiMute	= false;
var hdmiVolume	= 50;
var tvPower	= false;

function HdmiPortMap(inputPort) {
	inputPort = parseInt(inputPort);
	for (var mapping in portMapping){
		if (portMapping[mapping] == inputPort){
			return mapping;
        	}
    	};
	return -1;
};



// Kill cec-client process on exit

process.on("SIGINT", function() {
	if(cec!=null){
		cec.stop();
	}
	process.exit();
});


// CEC Event Handling

cec.once("ready", function(client) {
	console.log(" -- CEC-CLIENT READY -- ");
	cec.sendCommand( 0xE0, CEC.Opcode.GIVE_DEVICE_POWER_STATUS);
	cec.sendCommand( 0xE5, CEC.Opcode.GIVE_AUDIO_STATUS);
});

cec.on("REPORT_POWER_STATUS", function (packet, status) {
	var keys = Object.keys( CEC.PowerStatus );
	//if (fromSource == 0)
	if (packet.source == 0){
		if (status == CEC.PowerStatus.STANDBY) {
			tvPower=false;
		}
		else if (status == CEC.PowerStatus.ON) {
			tvPower=true;
		} 
	}
	for (var i = keys.length - 1; i>=0; i--) {
		if(CEC.PowerStatus[keys[i]] == status) {
			console.log("POWER_STATUS: ", keys[i]);
			break;
		}
	}
});

cec.on("REPORT_AUDIO_STATUS", function (packet, audioStatus) {
	
	// If value greater than 0x80, we are muted
	if (audioStatus>127)
	{
		hdmiMute = true;
		// Real volume when mute is off will be 128 less than reported
		hdmiVolume = audioStatus - 128;
	}
	// Otherwise we are not muted
	else
	{
		hdmiMute = false;
		hdmiVolume = audioStatus;
	}	
});

cec.on("ROUTING_CHANGE", function(packet, fromSource, toSource) {
	newInput = HdmiPortMap(toSource);
	if (newInput!=-1)
		hdmiInput = HdmiPortMap(toSource);
	
	console.log("Routing changed from " + fromSource.toString(16) + " to " + toSource.toString(16) + "(HDMI " + hdmiInput + ").");
	
});


// START CEC CLIENT

// -m  = start in monitor-mode
// -d8 = set log level to 8 (=TRAFFIC) (-d 8)
// -br = logical address set to 'recording device'
cec.start("cec-client", "-m", "-d", "8", "-t", "r");




function defaultContentTypeMiddleware (req, res, next) {
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  next();
}

app.use(defaultContentTypeMiddleware);

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = process.env.PORT || 8080;

// ROUTES FOR OUR API
// ====================================================================

var router = express.Router();		// create an instantiation of the express router

// add middleware for all requests
router.use(function(req, res, next) {
	// Log stuff
	console.log("[%s] %s %s %s", new Date().toUTCString(), req.ip, req.method, req.originalUrl);
	next();
});

router.get("/", function(req, res) {
	res.json({ message: "200 OK :D" });
});


// Handle Input Changing Endpoint
router.route("/input")
	.get(function(req, res) {
		// Show current input
		res.json({ currentInput: hdmiInput });
	})
	.put(function(req, res) {
		var newMappedPort = portMapping[req.body.input];
		console.log("DATA: " + req.body.input);
		
		if (newMappedPort !== undefined){
			cec.sendCommand(0xEF, CEC.Opcode.ACTIVE_SOURCE, (newMappedPort >> 8) & 0xFF, newMappedPort & 0xFF)
			hdmiInput = req.body.input;
			res.status(204).end();
		}
		else {
			res.status(400).send("Invalid HDMI Input");
		}
	});


// Handle Volume
router.route("/volume")
	.get(function(req, res) {
		cec.sendCommand( 0xE5, CEC.Opcode.GIVE_AUDIO_STATUS);
		setTimeout(function() { res.json({currentVolume: hdmiVolume}) }, 500);
	})
	.put(function(req,res) {
		var newVolume = req.params.volume;
		// Need to determine if current volume is same as 
		// requested volume.  Can we rely on internal vol status?
		
		// Do some for loop to press vol up or vol down
		// however many times to get to the desired level
		res.send("STUB");
	});

// Handle muting
router.route("/mute/:muteStatus*?")
	.get(function(req, res) {
		cec.sendCommand( 0xE5, CEC.Opcode.GIVE_AUDIO_STATUS);
		setTimeout(function() { res.json(hdmiMute ? 1 : 0) }, 500);
	})
	.put(function(req,res) {
		cec.sendCommand( 0xE5, CEC.Opcode.GIVE_AUDIO_STATUS);
			setTimeout(function() {
			// TODO: Figure out how to send toggle mute
			switch(req.params.muteStatus){
				case "on":
					if (!hdmiMute){
						//send mute
						cec.sendCommand( 0xE5, CEC.Opcode.USER_CONTROL_PRESSED, CEC.UserControlCode.MUTE);
						cec.sendCommand( 0xE5, CEC.Opcode.USER_CONTROL_RELEASE);
					}
					res.status(204).end();
					break;
				case "off":
					if (hdmiMute) {
						//send mute
						cec.sendCommand( 0xE5, CEC.Opcode.USER_CONTROL_PRESSED, CEC.UserControlCode.MUTE);
						cec.sendCommand( 0xE5, CEC.Opcode.USER_CONTROL_RELEASE);
					}
					res.status(204).end();
					break;
				case undefined:
					//send mute
					cec.sendCommand( 0xE5, CEC.Opcode.USER_CONTROL_PRESSED, CEC.UserControlCode.MUTE);
					cec.sendCommand( 0xE5, CEC.Opcode.USER_CONTROL_RELEASE);
					res.status(204).end();
					break;
				default:
					res.status(400).send("Invalid mute state");
			}
		},500);
	});

// Handle Power
router.route("/power/:device")
	.get(function(req, res) {
		cec.sendCommand( 0xE0, CEC.Opcode.GIVE_DEVICE_POWER_STATUS);
		setTimeout(function() {
			if (req.params.device == "TV") {
				res.send(tvPower ? "1" : "0");
			}
			else {
				res.send("STUB");
			}
		}, 500);
	})
	.put(function(req,res) {
		var destinationDevice = -1;
		switch (req.params.device){
			case "TV":
				destinationDevice=CEC.LogicalAddress.TV;
				break;
			case "AUDIOSYSTEM":
				destinationDevice=CEC.LogicalAddress.AUDIOSYSTEM;
				break;
			default:
				req.status(400).send("Invalid Device");
		}
		if (destinationDevice != -1){
			switch (req.body.state) {
				case "off":
					cec.sendCommand((0xE0+destinationDevice), CEC.Opcode.STANDBY);
					console.log("Powering off %s", req.params.device);
					res.status(204).end();
					break;
				case "on":
					cec.sendCommand((0xE0+destinationDevice), CEC.Opcode.IMAGE_VIEW_ON);
					console.log("Powering on %s", req.params.device);
					res.status(204).end();
					break;
			}
		}
	})
	.delete(function(req,res) {
		var destinationDevice = -1;
		switch (req.params.device){
			case "TV":
				destinationDevice=CEC.LogicalAddress.TV;
				break;
			case "AUDIOSYSTEM":
				destinationDevice=CEC.LogicalAddress.AUDIOSYSTEM;
				break;
			default:
				req.status(400).send("Invalid Device");
		}
		if (destinationDevice != -1){
			cec.sendCommand((0xE0+destinationDevice), CEC.Opcode.STANDBY);
			console.log("Powering off %s", req.params.device);
			res.status(204).end();
		}
	});
	

	
router.route("/audio")
	.put(function(req, res) {
		var options = {
			url: 'http://192.168.2.228:52323/upnp/control/IRCC',
			headers: {
				'Content-Type': 'text/xml; charset=UTF-8',
				'SOAPACTION': '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"'
			},
			body: '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>AAAAAgAAANAAAAAHAQ==</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>'
		};
		
		var interKeyTime = 1500;
		Step(		
			// Press Home
			function(){request.post(options,this)},
			function(){setTimeout(this, interKeyTime);},
			function(){request.post(options,this)},
			function(){setTimeout(this, interKeyTime);},
			function(){request.post(options,this)},
			function(){setTimeout(this, interKeyTime);},

			// Press down three times
			function(){options.body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>AAAAAwAAAhAAAAB5AQ==</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>';
			request.post(options,this);},
			function(){setTimeout(this, interKeyTime);},
			function(){request.post(options,this)},
			function(){setTimeout(this, interKeyTime);},
			function(){request.post(options,this)},
			function(){setTimeout(this, interKeyTime);},

			// Press enter (we are now on 'audio'....hopefully)
			function(){options.body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>AAAAAwAAAhAAAAB8AQ==</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>';
			request.post(options, this);}
		);
		
		res.status(204).end();
	});


// Allow sending a raw HDMI CEC command (hex)
router.route("/rawcmd/:cmd")
	.put(function(req, res) {
		cec.sendCommand( 0xE5, req.params.cmd);
	});

router.route("/wol/:mac")
	.put(function(req, res) {
		wol.wake(req.params.mac, function(error){
			if (error) {
				res.status(400).send("WOL Error");
			}
			else {
				res.status(204).end();
			}
		});
	});
// more routes can go here

// REGISTER OUR ROUTES -------------
// everything will be prefixed with /api

app.use("/api", router);



// START THE SERVER
// ====================================================================

app.listen(port);
console.log("Server started on port " + port);
