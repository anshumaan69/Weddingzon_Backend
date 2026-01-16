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

// User Cache Options
const userOptions = {
    max: 1000,
    ttl: 1000 * 60 * 15, // 15 Minutes (Stale data is bad for profile updates, relies on invalidation)
};
const userCache = new LRUCache(userOptions);

module.exports = {
    cache,
    userCache,
    getStats: () => ({ hits, misses, size: cache.size, userCacheSize: userCache.size }),
    get: (key) => {
        const val = cache.get(key);
        if (val) hits++;
        else misses++;
        return val;
    },
    set: (key, val, ttl) => cache.set(key, val, { ttl })
};
