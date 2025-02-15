'use strict';

/* ============================
   Firebase & Presence-Konfiguration
============================ */
// Fügen Sie hier Ihre Firebase-Konfiguration ein!
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* ============================
   Globale Variablen & UI-Elemente
============================ */
let userId = null;         // Eindeutige Benutzer-ID
let userName = "";         // Aktueller Benutzername
let userMarker = null;     // Leaflet-Marker des aktuellen Benutzers
let userLocation = null;   // { lat, lon }
const mapContainer = document.getElementById('map');
const connectionStatus = document.getElementById('connectionStatus');
const userNameInput = document.getElementById('userName');

/* Zufällig generierten Namen erstellen */
function generateRandomName() {
  const adjectives = ["Stiller", "Flinker", "Mutiger", "Sonniger", "Kühler"];
  const animals = ["Löwe", "Falke", "Panther", "Wolf", "Adler"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const ani = animals[Math.floor(Math.random() * animals.length)];
  return `${adj} ${ani}`;
}

/* Initialer Name setzen */
userName = generateRandomName();
userNameInput.value = userName;

/* Aktualisieren des Namens in Firebase */
function updateUserName(newName) {
  userName = newName;
  if (userId) {
    db.ref(`users/${userId}`).update({ name: userName });
  }
}

/* Event: Name ändern */
userNameInput.addEventListener('change', (e) => {
  updateUserName(e.target.value.trim() || generateRandomName());
});

/* ============================
   Leaflet-Karte initialisieren
============================ */
const map = L.map('map').setView([0, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap-Mitwirkende'
}).addTo(map);

/* Marker-Speicher (für andere Benutzer) */
const markers = {};

/* ============================
   Benutzer Präsenz in Firebase verwalten
============================ */
function addOrUpdateUser(userId, data) {
  if (markers[userId]) {
    // Marker aktualisieren
    markers[userId].setLatLng([data.lat, data.lon]);
    markers[userId].bindPopup(data.name);
  } else {
    // Marker hinzufügen (andere Benutzer – eigene Marker werden anders behandelt)
    const marker = L.marker([data.lat, data.lon]).addTo(map);
    marker.bindPopup(data.name);
    markers[userId] = marker;
  }
}

/* Entferne Benutzermarker */
function removeUser(userId) {
  if (markers[userId]) {
    map.removeLayer(markers[userId]);
    delete markers[userId];
  }
}

/* ============================
   Geolocation & Präsenz-Daten senden
============================ */
function updateLocation(position) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  userLocation = { lat, lon };

  // Setze Kartenansicht auf den eigenen Standort
  map.setView([lat, lon], 13);

  // Eigener Marker (optional farblich unterscheiden)
  if (userMarker) {
    userMarker.setLatLng([lat, lon]);
  } else {
    userMarker = L.marker([lat, lon], { icon: L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png',
      shadowSize: [41, 41]
    })}).addTo(map);
    userMarker.bindPopup(`<strong>${userName}</strong> (Sie)`);
  }

  // Sende oder aktualisiere Präsenz in Firebase
  if (!userId) {
    // Neuer Benutzer: Erzeuge eindeutige ID
    userId = db.ref('users').push().key;
    // Speichere den OnDisconnect-Handler
    db.ref(`users/${userId}`).onDisconnect().remove();
  }
  db.ref(`users/${userId}`).set({
    name: userName,
    lat: lat,
    lon: lon,
    timestamp: Date.now()
  });
  connectionStatus.textContent = "Sie sind online.";
}

/* Fehlerbehandlung bei Geolocation */
function handleLocationError(err) {
  console.error("Geolocation-Fehler:", err);
  connectionStatus.textContent = "Fehler bei der Standortbestimmung.";
}

/* Geolocation anfragen */
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(updateLocation, handleLocationError);
  // Optional: Standortperiodisch aktualisieren
  setInterval(() => {
    navigator.geolocation.getCurrentPosition(updateLocation, handleLocationError);
  }, 30000);
} else {
  connectionStatus.textContent = "Ihr Browser unterstützt keine Geolocation.";
}

/* ============================
   Firebase: Auf Präsenzänderungen hören
============================ */
db.ref('users').on('value', snapshot => {
  const users = snapshot.val();
  // Aktualisiere Marker für alle Benutzer (außer dem eigenen)
  for (const id in users) {
    if (id !== userId) {
      addOrUpdateUser(id, users[id]);
    }
  }
}, err => {
  console.error("Firebase DB Fehler:", err);
});

/* Entferne Marker, wenn Benutzer offline gehen */
db.ref('users').on('child_removed', snapshot => {
  removeUser(snapshot.key);
});

/* ============================
   Weitere Funktionen (Dateiübertragung, Chat, Snapshot)
   – Der Code aus den vorherigen Beispielen kann hier integriert werden.
============================ */

/* Beispiel: Dateiübertragung, Chat, Snapshot – siehe vorherige Implementierungen */
/* Für den Fokus auf die Präsenz & Discovery wurde hier der Verbindungs-Teil überarbeitet. */
