require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const cors = require('cors');
const axios = require('axios');
const mcache = require('memory-cache'); // Caching library

const app = express();
const port = process.env.PORT || 3000;

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID; // Set these in your environment
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);
const twilioNumber = process.env.TWILIO_NUMBER;

// Google Maps API Key from environment variables
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

app.use(cors()); // Enable CORS for all routes
app.use(bodyParser.json());

// Helper function to get address from cache or API
async function getAddressFromCoordinates(latitude, longitude) {
    const cacheKey = `${latitude},${longitude}`;
    const cachedAddress = mcache.get(cacheKey);
    
    if (cachedAddress) {
        return cachedAddress; // Return cached address
    }

    try {
        const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
            params: {
                latlng: `${latitude},${longitude}`,
                key: googleMapsApiKey
            }
        });
        
        if (response.data.results.length > 0) {
            const address = response.data.results[0].formatted_address;
            mcache.put(cacheKey, address, 3600000); // Cache for 1 hour
            return address;
        } else {
            return 'Location not found';
        }
    } catch (error) {
        console.error('Error fetching address:', error);
        return 'Unable to fetch address';
    }
}

app.post('/webhook', async (req, res) => {
    try {
        // Log the received body and headers for debugging
        console.log('Received body:', req.body);
        console.log('Received headers:', req.headers);

        // Get the incoming data directly from the request body
        const alarmData = req.body;

        // Extract necessary data
        const toNumber = req.headers['x-phone-number'];
        const alarmEvent = alarmData['alarm.event'] || false; // Default to false
        const batteryLevel = alarmData['battery.level'];
        const batteryVoltage = Math.floor(alarmData['external.powersource.voltage'] * 10) / 10; // Round down
        const deviceName = alarmData['device.name'];
        const latitude = alarmData['position.latitude'];
        const longitude = alarmData['position.longitude'];
        const engineStatus = alarmData['engine.ignition.status'];

        // Check if the alarm event is true and engine status is false
        if (alarmEvent && !engineStatus) {
            const address = await getAddressFromCoordinates(latitude, longitude);

            const message = `
                Motorbike alarm activated.
                Current Location: ${address}.
                Device: ${deviceName}.
                Tracker Battery Level: ${batteryLevel}%.
                External Power Source Voltage: ${batteryVoltage} volts.
            `.replace(/\n/g, ' ');

            const messageUrl = 'https://twimlets.com/echo?Twiml=' + encodeURIComponent(`
                <Response>
                    <Say>${message}</Say>
                    <Say>Goodbye!</Say>
                </Response>
            `);

            await client.calls.create({
                url: messageUrl,
                to: toNumber,
                from: twilioNumber,
            });

            console.log(`Call initiated to ${toNumber}`);
            return res.status(200).send('Call initiated');
        } else {
            console.log('No call made due to engine status or alarm event.');
            return res.status(200).send('No call made due to engine status or alarm event.');
        }

    } catch (error) {
        console.error('Error processing request:', error);
        return res.status(400).send('Invalid JSON payload');
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
