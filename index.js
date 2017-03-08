// vim: set sw=4:sts=4:

const _ = require('lodash');
const admin = require('firebase-admin');
const RaspiSensors = require('raspi-sensors');
const celsiusToFahrenheit = require('celsius-to-fahrenheit');
const GPIO = require('onoff').Gpio;
const mqtt = require('mqtt');

// Firebase
admin.initializeApp({
    credential: admin.credential.cert('home-thermostat-private-key.json'),
    databaseURL: 'https://home-thermostat-b9f4b.firebaseio.com'
});
const db = admin.database();
const ref = db.ref('home');
const temps = ref.child('temperatures');

const CLIENTID = 'rpi';

const DHT22 = new RaspiSensors.Sensor({
    type: 'DHT22',
    pin: 7
}, 'temp_sensor');  // An additional name can be provided after the sensor's configuration 


const targetTemp = 70.0;
const relay = new GPIO(18, 'out', 'none', {activeLow: true});
relay.writeSync(0);

const mqttClient = mqtt.connect({
    host: 'm12.cloudmqtt.com',
    port: 17718,
    username: 'nodejs',
    password: 'password1',
    clientId: CLIENTID
});

mqttClient.on('connect', (connack) => {
    console.log('MQTT connected!');
    mqttClient.subscribe(`DHT/${CLIENTID}/relay`, (err, granted) => {
        if (err) {
            return console.error(`Error subscribing to topic: ${err}`);
        }
        console.log('subscribed to:', granted);
    });
});

mqttClient.on('message', (topic, msg, packet) => {
    console.log('message received: ', topic, msg.toString());
    if (topic == `DHT/${CLIENTID}/relay`) {
        relay.writeSync(Number(msg));
    }
});

process.env.WIRINGPI_GPIOMEM = '1';

DHT22.fetchInterval((err, data) => {
    if (err) {
        return console.error(err);
        process.exit(1);
    }

    data.value = _.round(data.value, 2);

    if (data.type == 'Temperature') {
        data.value = celsiusToFahrenheit(data.value);
        data.unit = 'Degrees Farenheit';
        data.unit_display = '°F';
        if (data.value < targetTemp) {
            relay.writeSync(1);
        } else {
            relay.writeSync(0);
        }
        mqttClient.publish(`DHT/${CLIENTID}/relay`, relay.readSync().toString());
        console.log('published relay value:', relay.readSync().toString());
    }

    data.location = 'Living Room';

    console.log('type:', data.type);
    console.log('value:', data.value);
    temps.push(data);
    mqttClient.publish(`DHT/${CLIENTID}/${data.type.toLowerCase()}`, data.value.toString());
}, 15);

process.on('SIGINT', () => {
    console.log('caught sigint, exiting');
	DHT22.fetchClear();
    mqttClient.end();
    process.exit(0);
});

