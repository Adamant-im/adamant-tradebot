'use strict';

/**
 * Minimal MongoDB document wrapper: maps a native collection to a class with `save()` / static query helpers.
 *
 * @module helpers/dbModel
 */

const log = require('./log');

/**
 * Creates a `Model` class bound to a MongoDB collection.
 *
 * @param {import('mongodb').Collection} db Native MongoDB collection
 * @returns {import('types/bot/db.d.js').DbModelCollection<any>}
 */
module.exports = (db) => {
  class Model {
    /**
     * Creates a document instance from plain data.
     *
     * Note: the constructor is synchronous. When `shouldSave` is `true`, `save()` is called
     * without `await`. Prefer `shouldSave = false` and then `await record.save()` when the
     * caller needs to handle persistence errors.
     *
     * @param {Record<string, unknown>} [data] Document fields
     * @param {boolean} [shouldSave=false] Whether to persist the document immediately
     */
    constructor(data = {}, shouldSave = false) {
      this.db = db;

      Object.assign(this, data);

      if (shouldSave) {
        this.save().catch((err) => {
          log.error(`dbModel: Failed to save a new document on construction: ${err}`);
        });
      }
    }

    /** @returns {import('mongodb').Collection} */
    static get db() {
      return db;
    }

    /**
     * Finds documents and wraps each result in a model instance.
     *
     * @param {import('mongodb').Filter<import('mongodb').Document>} [req] MongoDB filter
     * @returns {Promise<InstanceType<typeof Model>[]>}
     */
    static async find(req) {
      const data = await db.find(req).toArray();

      return data.map((d) => new this(d));
    }

    /**
     * Runs an aggregation pipeline and wraps each result in a model instance.
     *
     * @param {import('mongodb').Document[]} req Aggregation pipeline
     * @returns {Promise<InstanceType<typeof Model>[]>}
     */
    static async aggregate(req) {
      const data = await db.aggregate(req).toArray();

      return data.map((d) => new this(d));
    }

    /**
     * Finds a single document and wraps it in a model instance.
     *
     * @param {import('mongodb').Filter<import('mongodb').Document>} [req] MongoDB filter
     * @returns {Promise<InstanceType<typeof Model> | null>}
     */
    static async findOne(req) {
      const doc = await db.findOne(req);

      return doc ? new this(doc) : null;
    }

    /**
     * Deletes a single document matching the filter.
     *
     * @param {import('mongodb').Filter<import('mongodb').Document>} req MongoDB filter
     * @returns {Promise<number>} Number of deleted documents
     */
    static async deleteOne(req) {
      // Prevent accidental `db` field in the filter from shadowing the collection reference
      delete req.db;

      const { deletedCount } = await db.deleteOne(req);

      return deletedCount;
    }

    /**
     * Updates a single document.
     *
     * @param {{ filter: import('mongodb').Filter<import('mongodb').Document>, update: import('mongodb').UpdateFilter<import('mongodb').Document>, options?: import('mongodb').UpdateOptions }} req Update request
     * @returns {Promise<import('mongodb').UpdateResult>}
     */
    static async updateOne(req) {
      const { filter, update, options = {} } = req;

      return db.updateOne(filter, update, options);
    }

    /**
     * Counts documents matching the filter.
     *
     * @param {import('mongodb').Filter<import('mongodb').Document>} [req] MongoDB filter
     * @returns {Promise<number>}
     */
    static async count(req) {
      return db.countDocuments(req);
    }

    /**
     * Serializes instance fields for MongoDB, excluding internal properties.
     *
     * @returns {Record<string, unknown>}
     * @private
     */
    _data() {
      /** @type {Record<string, unknown>} */
      const data = {};

      for (const fieldName in this) {
        if (Object.prototype.hasOwnProperty.call(this, fieldName)) {
          if (!['db', '_id'].includes(fieldName)) {
            data[fieldName] = this[fieldName];
          }
        }
      }

      return data;
    }

    /**
     * Merges fields into the instance and optionally persists the document.
     *
     * @param {Record<string, unknown>} obj Fields to merge
     * @param {boolean} [shouldSave] When `true`, calls `save()` after merging
     * @returns {Promise<void | import('mongodb').ObjectId>}
     */
    async update(obj, shouldSave) {
      Object.assign(this, obj);

      if (shouldSave) {
        return this.save();
      }
    }

    /**
     * Inserts a new document or upserts an existing one by `_id`.
     *
     * @returns {Promise<import('mongodb').ObjectId>} Document `_id`
     */
    async save() {
      if (!this._id) {
        const res = await db.insertOne(this._data());
        this._id = res.insertedId;
        return this._id;
      }

      await db.updateOne({ _id: this._id }, {
        $set: this._data(),
      }, { upsert: true });

      return this._id;
    }
  }

  return Model;
};
