const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const connectDB = require('./config/db');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

// Connect to Database (Placeholder for now)
connectDB();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

// Routes
app.use('/', routes);

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

module.exports = app;
