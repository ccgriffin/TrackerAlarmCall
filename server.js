require('dotenv').config(); // Load environment variables from .env file
const express = require('express'); // Express framework for creating web server
const bodyParser = require('body-parser'); // Middleware for parsing incoming JSON request bodies
const twilio = require('twilio'); // Twilio SDK to handle calls
const cors = require('cors'); // Enable Cross-Origin Resource Sharing
const axios = require('axios'); // Axios for making HTTP requests
const mcache = require('memory-cache'); // Caching library to store API responses

const app = express(); // Create an Express application
const port = process.env.PORT || 3000; // Set the server port, default to 3000

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID; // Twilio account SID
const authToken = process.env.TWILIO_AUTH_TOKEN; // Twilio authentication token
const client = twilio(accountSid, authToken); // Initialize Twilio client with credentials
const twilioNumber = process.env.TWILIO_NUMBER; // Twilio phone number

// Google Maps API Key from environment variables
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY; // Google Maps API key for geocoding

app.use(cors()); // Enable CORS for all incoming requests
app.use(bodyParser.json()); // Enable JSON body parsing middleware

// Helper function to get address from cache or Google Maps API
async function getAddressFromCoordinates(latitude, longitude) {
    const cacheKey = `${latitude},${longitude}`; // Create cache key using lat, lon
    const cachedAddress = mcache.get(cacheKey); // Check if address is already cached
    
    if (cachedAddress) {
        return cachedAddress; // Return cached address if found
    }

    try {
        const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
            params: {
                latlng: `${latitude},${longitude}`, // Pass latitude and longitude to API
                key: googleMapsApiKey // Include Google Maps API key
            }
        });
        
        if (response.data.results.length > 0) {
            const address = response.data.results[0].formatted_address; // Extract formatted address
            mcache.put(cacheKey, address, 3600000); // Cache address for 1 hour
            return address; // Return the fetched address
        } else {
            return 'Location not found'; // If no results, return default message
        }
    } catch (error) {
        console.error('Error fetching address:', error); // Log error if API call fails
        return 'Unable to fetch address'; // Return error message
    }
}

// POST endpoint for receiving webhook data
app.post('/webhook', async (req, res) => {
    try {
        console.log('Received body:', req.body); // Log received request body for debugging
        console.log('Received headers:', req.headers); // Log received request headers

        const alarmData = req.body; // Extract incoming data from the request body

        // Extract specific data fields from the request
        const toNumber = req.headers['x-phone-number']; // Phone number to call (from headers)
        const alarmEvent = alarmData['alarm.event'] || false; // Alarm event status (default to false)
        const batteryLevel = alarmData['battery.level']; // Battery level percentage
        const batteryVoltage = Math.floor(alarmData['external.powersource.voltage'] * 10) / 10; // Round external power voltage to 1 decimal place
        const deviceName = alarmData['device.name']; // Name of the device (e.g., motorbike)
        const latitude = alarmData['position.latitude']; // Latitude for location
        const longitude = alarmData['position.longitude']; // Longitude for location
        const engineStatus = alarmData['engine.ignition.status']; // Engine ignition status

        // Get current time as webhook received time (in HH:MM:SS format)
        const receivedTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Check if the alarm event is true and the engine is off (to trigger the call)
        if (alarmEvent && !engineStatus) {
            const address = await getAddressFromCoordinates(latitude, longitude); // Get location address from coordinates

            // Create the message that will be spoken in the call
            const message = `
                Motorbike alarm activated.
                Current Location: ${address}.
                Device: ${deviceName}.
                Tracker Battery Level: ${batteryLevel}%.
                External Power Source Voltage: ${batteryVoltage} volts.
                Webhook received at: ${receivedTime}.
            `.replace(/\n/g, ' '); // Replace new lines with spaces

            // URL that Twilio will use to generate the call message
            const messageUrl = 'https://twimlets.com/echo?Twiml=' + encodeURIComponent(`
                <Response>
                    <Say>${message}</Say>
                    <Say>Goodbye!</Say>
                </Response>
            `);

            // Initiate the call using Twilio's API
            await client.calls.create({
                url: messageUrl, // The TwiML URL that Twilio will use to speak the message
                to: toNumber, // The recipient's phone number
                from: twilioNumber, // The Twilio number making the call
            });

            console.log(`Call initiated to ${toNumber}`); // Log successful call initiation
            return res.status(200).send('Call initiated'); // Send success response
        } else {
            console.log('No call made due to engine status or alarm event.'); // Log why no call was made
            return res.status(200).send('No call made due to engine status or alarm event.'); // Send no call made response
        }

    } catch (error) {
        console.error('Error processing request:', error); // Log any errors that occur during request processing
        return res.status(400).send('Invalid JSON payload'); // Send error response if JSON is invalid
    }
});

// Start the server on the defined port
app.listen(port, () => {
    console.log(`Server running on port ${port}`); // Log that the server has started
});
