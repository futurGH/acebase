const { NodeInfo } = require('./node-info');
const { PathInfo } = require('acebase-core');

const SECOND = 1000;
const MINUTE = 60000;

const DEBUG_MODE = false;
const CACHE_TIMEOUT = DEBUG_MODE ? 5 * MINUTE : MINUTE;

class NodeCacheEntry {

    /**
     * 
     * @param {NodeInfo} nodeInfo 
     */
    constructor(nodeInfo) {
        this.nodeInfo = nodeInfo;
        this.created = Date.now();
        this.keepAlive();
    }

    keepAlive() {
        this.expires = (this.created || this.updated) + NodeCache.CACHE_DURATION;
    }

    /**
     * 
     * @param {NodeInfo} nodeInfo 
     */
    update(nodeInfo) {
        this.nodeInfo = nodeInfo;
        this.updated = Date.now();
        this.keepAlive();
    }
}

class NodeCache {
    static get CACHE_DURATION() { return CACHE_TIMEOUT; }

    constructor() {
        // Isolated cache, this enables using multiple databases each with their own cache

        this. _cleanupTimeout = null;
        /** @type {Map<string, NodeCacheEntry>} */
        this._cache = new Map(); //{ };        
    }

    _assertCleanupTimeout() {
        if (this._cleanupTimeout === null) {
            this._cleanupTimeout = setTimeout(() => {
                this.cleanup();
                this._cleanupTimeout = null;
                if (this._cache.size > 0) {
                    this._assertCleanupTimeout();
                }
            }, CACHE_TIMEOUT);
        }
    }

    /**
     * Updates or adds a NodeAddress to the cache
     * @param {NodeInfo} nodeInfo 
     * @param {boolean} [overwrite=true] if the cache must be overwritten if the entry already exists
     */
    update(nodeInfo, overwrite = true) {
        if (!(nodeInfo instanceof NodeInfo)) {
            throw new TypeError(`nodeInfo must be an instance of NodeInfo`);
        }
        if (nodeInfo.path === "") {
            // Don't cache root address, it has to be retrieved from storage.rootAddress
            return;
        }
        let entry = this._cache.get(nodeInfo.path);
        if (entry) {
            if (!overwrite) {
                DEBUG_MODE && console.error(`CACHE SKIP ${nodeInfo}`);
            }
            else {
                DEBUG_MODE && console.error(`CACHE UPDATE ${nodeInfo}`);
                entry.update(nodeInfo);
            }
        }
        else {
            // New entry
            DEBUG_MODE && console.error(`CACHE INSERT ${nodeInfo}`);
            entry = new NodeCacheEntry(nodeInfo);
            this._cache.set(nodeInfo.path, entry);
        }
        this._assertCleanupTimeout();
    }

    /**
     * Invalidates a node and (optionally) its children by removing them from cache
     * @param {string} path 
     * @param {boolean} recursive 
     * @param {string} reason 
     */
    invalidate(path, recursive, reason) {
        const entry = this._cache.get(path);
        if (entry) {
            DEBUG_MODE && console.error(`CACHE INVALIDATE ${reason} => ${entry.nodeInfo}`);
            this._cache.delete(path);
        }
        if (recursive) {
            const pathInfo = PathInfo.get(path);
            this._cache.forEach((entry, cachedPath) => {
                if (pathInfo.isAncestorOf(cachedPath)) {
                    DEBUG_MODE && console.error(`CACHE INVALIDATE ${reason} => (child) ${entry.nodeInfo}`);
                    this._cache.delete(cachedPath);
                }
            });
        }
    }

    /**
     * Marks the node at path, and all its descendants as deleted
     * @param {string} path 
     */
    delete(path) {
        this.update(new NodeInfo({ path, exists: false }));
        const pathInfo = PathInfo.get(path);
        this._cache.forEach((entry, cachedPath) => {
            if (pathInfo.isAncestorOf(cachedPath)) {
                this.update(new NodeInfo({ path: cachedPath, exists: false }));
            }
        });
    }

    cleanup() {
        const now = Date.now();
        const entriesBefore = this._cache.size;
        this._cache.forEach((entry, path) => {
            if (entry.expires <= now) {
                this._cache.delete(path);
            }
        });
        const entriesAfter = this._cache.size;
        const entriesRemoved = entriesBefore - entriesAfter;
        DEBUG_MODE && console.log(`CACHE Removed ${entriesRemoved} cache entries (${entriesAfter} remain cached)`);
    }

    clear() {
        this._cache.clear();
    }

    /**
     * Finds cached NodeInfo for a given path. Returns null if the info is not found in cache
     * @param {string} path 
     * @returns {NodeInfo|null} cached info or null
     */
    find(path) {
        let entry = this._cache.get(path) || null;
        if (entry && entry.nodeInfo.path !== "") {
            if (entry.expires <= Date.now()) {
                // expired
                this._cache.delete(path);
                entry = null;
            }
            else {
                // Increase lifetime
                entry.keepAlive();
            }
        }
        this._assertCleanupTimeout();
        DEBUG_MODE && console.error(`CACHE FIND ${path}: ${entry ? entry.nodeInfo : 'null'}`);
        return entry ? entry.nodeInfo : null;
    }

    /**
     * Finds the first cached NodeInfo for the closest ancestor of a given path
     * @param {string} path 
     * @returns {NodeInfo} cached info for an ancestor
     */
    findAncestor(path) {
        while (true) {
            path = getPathInfo(path).parent;
            if (path === null) { return null; }
            const entry = this.find(path);
            if (entry) { return entry; }
        }
    }
}

module.exports = { NodeCache, NodeCacheEntry };