const mongoose = require('mongoose');
const dotenv = require('dotenv');
const FilterConfig = require('../src/models/FilterConfig');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const filters = [
    // --- BASIC DETAILS ---
    { label: 'Sort By', key: 'sortBy', type: 'select', options: ['created_at', 'age_asc', 'age_desc'], section: 'Basic', order: 1 },
    { label: 'Age Range', key: 'age', type: 'range', section: 'Basic', order: 2 }, // Special handling in frontend for min/max
    { label: 'Gender', key: 'gender', type: 'select', options: ['Male', 'Female', 'Other'], section: 'Basic', order: 3 },
    { label: 'Marital Status', key: 'marital_status', type: 'select', options: ['Any', 'Never Married', 'Divorced', 'Widowed', 'Awaiting Divorce'], section: 'Basic', order: 4 },
    { label: 'Profile Created For', key: 'created_for', type: 'select', options: ['Self', 'Parent', 'Sibling', 'Relative', 'Friend', 'Marriage Bureau'], section: 'Basic', order: 5 },
    { label: 'Height', key: 'height', type: 'select', options: ["4'0\"", "4'5\"", "5'0\"", "5'5\"", "6'0\"", "6'5\""], section: 'Basic', order: 6 }, // Simplified options for brevity
    { label: 'Mother Tongue', key: 'mother_tongue', type: 'select', options: ['Hindi', 'English', 'Punjabi', 'Bengali', 'Marathi', 'Tamil', 'Telugu', 'Gujarati', 'Urdu'], section: 'Basic', order: 7 },
    { label: 'Disability', key: 'disability', type: 'select', options: ['None', 'Physical', 'Mental', 'Other'], section: 'Basic', order: 8 },

    // --- LOCATION ---
    { label: 'Country', key: 'country', type: 'text', section: 'Location', order: 10 },
    { label: 'State', key: 'state', type: 'text', section: 'Location', order: 11 },
    { label: 'City', key: 'city', type: 'text', section: 'Location', order: 12 },

    // --- FAMILY ---
    { label: 'Family Type', key: 'family_type', type: 'select', options: ['Joint', 'Nuclear'], section: 'Family', order: 20 },
    { label: 'Family Status', key: 'family_status', type: 'select', options: ['Middle Class', 'Upper Middle Class', 'Rich', 'Affluent'], section: 'Family', order: 21 },
    { label: 'Family Values', key: 'family_values', type: 'select', options: ['Orthodox', 'Traditional', 'Moderate', 'Liberal'], section: 'Family', order: 22 },
    { label: 'Brothers', key: 'brothers', type: 'number', section: 'Family', order: 23 },
    { label: 'Sisters', key: 'sisters', type: 'number', section: 'Family', order: 24 },

    // --- EDUCATION & CAREER ---
    { label: 'Highest Education', key: 'highest_education', type: 'select', options: ['High School', 'Bachelors', 'Masters', 'Doctorate'], section: 'Education', order: 30 },
    { label: 'Occupation', key: 'occupation', type: 'text', section: 'Education', order: 31 },
    { label: 'Employed In', key: 'employed_in', type: 'select', options: ['Private', 'Government', 'Business', 'Defence', 'Self Employed'], section: 'Education', order: 32 },
    { label: 'Annual Income', key: 'annual_income', type: 'select', options: ['0-5 LPA', '5-10 LPA', '10-20 LPA', '20-50 LPA', '50+ LPA'], section: 'Education', order: 33 },

    // --- RELIGIOUS ---
    { label: 'Religion', key: 'religion', type: 'select', options: ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain', 'Buddhist', 'Parsi', 'Jewish', 'Other'], section: 'Religious', order: 40 },
    { label: 'Community', key: 'community', type: 'text', section: 'Religious', order: 41 },
    { label: 'Sub Community', key: 'sub_community', type: 'text', section: 'Religious', order: 42 },

    // --- LIFESTYLE ---
    { label: 'Diet (Eating Habits)', key: 'eating_habits', type: 'select', options: ['Vegetarian', 'Non-Vegetarian', 'Eggetarian'], section: 'Lifestyle', order: 50 },
    { label: 'Smoking Habits', key: 'smoking_habits', type: 'select', options: ['No', 'Yes', 'Occasionally'], section: 'Lifestyle', order: 51 },
    { label: 'Drinking Habits', key: 'drinking_habits', type: 'select', options: ['No', 'Yes', 'Occasionally'], section: 'Lifestyle', order: 52 },
    { label: 'Appearance', key: 'appearance', type: 'select', options: ['Fair', 'Wheatish', 'Dusky'], section: 'Lifestyle', order: 53 },
    { label: 'Living Status', key: 'living_status', type: 'select', options: ['Living with Family', 'Living Alone'], section: 'Lifestyle', order: 54 },
    { label: 'Physical Status', key: 'physical_status', type: 'select', options: ['Normal', 'Physically Challenged'], section: 'Lifestyle', order: 55 },

    // --- PROPERTY ---
    { label: 'Property Type', key: 'property_type', type: 'select', options: ['Residential', 'Commercial', 'Agricultural', 'Industrial'], section: 'Property', order: 60 },
    { label: 'Land Area (Acres)', key: 'land_area', type: 'range', section: 'Property', order: 61 },
];

const seedFilters = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');

        // Clear existing
        await FilterConfig.deleteMany({});
        console.log('Cleared existing filters');

        // Insert new
        await FilterConfig.insertMany(filters);
        console.log(`Seeded ${filters.length} filters`);

        process.exit();
    } catch (error) {
        console.error('Seeding Error:', error);
        process.exit(1);
    }
};

seedFilters();
