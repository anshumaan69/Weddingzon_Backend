// src/utils/cache.js
const LRUCache = require('lru-cache');

// General Options
const options = {
    max: 500, // Max 500 items
    ttl: 1000 * 60 * 50, // 50 Minutes (Photos are valid for 60m)
    allowStale: false,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
};

const cache = new LRUCache(options);

// Metrics
let hits = 0;
let misses = 0;

module.exports = {
    cache,
    getStats: () => ({ hits, misses, size: cache.size }),
    get: (key) => {
        const val = cache.get(key);
        if (val) hits++;
        else misses++;
        return val;
    },
    set: (key, val, ttl) => cache.set(key, val, { ttl })
};
