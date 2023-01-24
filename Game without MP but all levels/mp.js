// Initialize the Firebase app
firebase.initializeApp({
  apiKey: "AIzaSyAhkOdJkIP433vWXbHL0958HhSlQSkGBY8",
  authDomain: "fb-wg-am.firebaseapp.com",
  projectId: "fb-wg-am",
  storageBucket: "fb-wg-am.appspot.com",
  messagingSenderId: "377764913862",
  appId: "1:377764913862:web:1377678cb444a5c1a72dc7",
  measurementId: "G-Q0MPPZVBXE",
  databaseURL:"https://fb-wg-am-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

// Get a reference to the Firebase Realtime Database
const database = firebase.database();

// Get a reference to the Firebase Auth service
const auth = firebase.auth();

// Function to handle the sign up form submission
function handleSignUp(event) {
  event.preventDefault();

  // Get the email and password values from the form
  const email = event.target.email.value;
  const password = event.target.password.value;

  // Create a new user using the createUserWithEmailAndPassword function
  auth.createUserWithEmailAndPassword(email, password)
    .then(function() {
      // If the user was successfully created, sign in the user
      return auth.signInWithEmailAndPassword(email, password);
    })
    .then(function() {
      // If the user was successfully signed in, redirect to the game page
      window.location.replace('/game.html');
    })
    .catch(function(error) {
      // If an error occurred, display an error message
      const errorMessage = error.message;
      alert(errorMessage);
    });
}

// Function to handle the sign in form submission
function handleSignIn(event) {
  event.preventDefault();

  // Get the email and password values from the form
  const email = event.target.email.value;
  const password = event.target.password.value;

  // Sign in the user using the signInWithEmailAndPassword function
  auth.signInWithEmailAndPassword(email, password)
    .then(function() {
      // If the user was successfully signed in, redirect to the game page
      window.location.replace('/game.html');
    })
    .catch(function(error) {
      // If an error occurred, display an error message
      const errorMessage = error.message;
      alert(errorMessage);
    });
}

// Function to handle the sign out button click
function handleSignOut() {
  // Sign out the user using the signOut function
  auth.signOut()
    .then(function() {
      // If the user was successfully signed out, redirect to the home page
      window.location.replace('/');
    })
    .catch(function(error) {
      // If an error occurred, display an error message
      const errorMessage = error.message;
      alert(errorMessage);
    });
}

// Register a callback to be called whenever the authentication state changes
auth.onAuthStateChanged(function(user) {
  if (user) {
    // If the user is signed in, show the game page
    document.getElementById('game-page').style.display = 'block';
    document.getElementById('sign-out-button').style.display = 'block';
  } else {
    // If the user is signed out, show the home page
    document.getElementById('home-page').style.display = 'block';
  }
});

