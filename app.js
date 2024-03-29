import OpenAI from "openai";
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch"; // Add this import

const openai = new OpenAI();
const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

app.set("view engine", "ejs");

const getData = async () => {
  var url = "https://donnees.montreal.ca/api/3/action/datastore_search";
  var resource_id = "05deae93-d9fc-4acb-9779-e0942b5e962f";
  var limit = 300000;

  // Construct the API request URL
  var apiUrl = `${url}?resource_id=${resource_id}&limit=${limit}`;

  const response = await fetch(apiUrl, {
    method: "GET",
    mode: "cors",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  const data = await response.json();

  // Dictionary of Weather codes
  let codes = { 11: "clear", 12: "cloudy", 13: "foggy", 14: "rainy", 15: "very-rainy", 16: "windy", 17: "snow-hail", 18: "snowstorm", 19: "icy", 99: "other" };

  if (data.result && data.result.records) {
    // Create an object to store occurrences
    let occurrences = {};

    data.result.records.forEach((record) => {
      // Access latitude and longitude properties
      let latitude = record.LOC_LAT;
      let longitude = record.LOC_LONG;

      // Round latitude and longitude to the nearest 0.00001
      latitude = Math.round(latitude * 10000) / 10000;
      longitude = Math.round(longitude * 10000) / 10000;

      //get accident severity, weather condition and time of accident
      let severity = record.GRAVITE;
      // let weather = record.CD_COND_METEO;
      let weather = codes[record.CD_COND_METEO];
      let time = record.HEURE_ACCDN.split("-").pop();

      // console.log(severity, weather, time);

      // Create a unique key for each location
      let location = `${latitude},${longitude}`;

      // Check if location object already exists
      if (occurrences[location]) {
        // Increment count, add new severity, weather conditions and times
        occurrences[location].count = occurrences[location].count + 1;
        // occurrences[location].severities.push(severity);
        occurrences[location].severities[severity] = (occurrences[location].severities[severity] || 0) + 1;

        // console.log(weather);
        // console.log("hello");

        // Check if weather condition already exists within location, adds to weather object
        occurrences[location].weatherConditions[weather] = (occurrences[location].weatherConditions[weather] || 0) + 1;

        // Check if time already exists within location, adds to times object
        occurrences[location].times[time] = (occurrences[location].times[time] || 0) + 1;
      } else {
        // Initialize location accident count, severity weather and time arrays
        // occurrences[location] = {count : 1, severities : [severity], weatherConditions : {[weather] : 1}, times : {[time] : 1} };
        occurrences[location] = { count: 1, severities: { [severity]: 1 }, weatherConditions: { [weather]: 1 }, times: { [time]: 1 } };
      }
    });

    // Create an array of locations with more than 10 occurrences
    let highOccurrenceLocations = [];
    for (let key in occurrences) {
      if (occurrences[key].count > 10) {
        let weatherMode;
        let count = 0;

        let [lat, lon] = key.split(",").map(parseFloat);

        // gets the mode for weather conditions
        let obj = occurrences[key].weatherConditions;
        for (let key in obj) {
          if (obj[key] > count) {
            weatherMode = key;
            count = obj[key];
          }
        }

        let timeMode;
        count = 0;

        // gets the mode for time
        obj = occurrences[key].times;
        for (let key in obj) {
          if (obj[key] > count) {
            timeMode = key;
            count = obj[key];
          }
        }

        highOccurrenceLocations.push({
          latitude: lat,
          longitude: lon,
          count: occurrences[key].count,
          severities: occurrences[key].severities,
          weather: weatherMode,
          time: timeMode,
          // weather : getMode(occurrences[key].weatherConditions),

          // time : getMode(occurrences[key].times),
          aiReply: "",
        });
      }
    }
    return highOccurrenceLocations;
  }
};

app.get("/", async (req, res) => {
  const data = await getData();
  res.render("index", { locations: data });
});

app.get("/ai", async (req, res) => {
  const data = await getData();

  for (let i = 0; i < data.length; i++) {
    const accident = data[i];
    const { time, weather, severities } = accident;

    const severityArray = Object.entries(severities).map(([severity, count]) => `${count} ${severity}`);

    const query = `Car accident happened at ${time} when the weather was ${weather} and the accidents that occurred were ${severityArray.join(", ")}`;
    try {
      if (data[i].count > 90) {
        const reply = await aiCall(query);

        data[i].aiReply = reply;
      }
    } catch (error) {
      console.error("Error making AI call:", error.message);
    }
  }

  res.render("index", { locations: data });
});

async function aiCall(query) {
  let retries = 3;
  let delay = 1000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: `Given this info, translate to english and give me 1 advice on how to prevent an accident given the cause of the accidents in under 10 words: ${query}` }],
        model: "gpt-3.5-turbo",
      });

      return completion.choices[0].message.content;
      break;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.log(`Rate limit exceeded. Retrying after ${delay / 1000} seconds (attempt ${attempt}/${retries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw error;
      }
    }
  }
}

app.listen(process.env.PORT || 4000);
