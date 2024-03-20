module.exports = (db) => {
  class Model {
    /**
     * Creates a Mongod record/document
     * Note: The constructor is not async; if you want to store the data in the database, consider that it will take time.
     * As a workaround, create a document with shouldSave=false and then do 'await record.save()'
     * @param {*} data Data to store
     * @param {boolean} [shouldSave=false] If store date in the database
     */
    constructor(data = {}, shouldSave = false) {
      this.db = db;

      Object.assign(this, data);

      if (shouldSave) {
        this.save();
      }
    }

    static get db() {
      return db;
    }
    static async find(req) {
      const data = await db.find(req).toArray();

      return data.map((d) => new this(d));
    }
    static async aggregate(req) {
      const data = await db.aggregate(req).toArray();

      return data.map((d) => new this(d));
    }
    static async findOne(req) {
      const doc = await db.findOne(req);

      return doc ? new this(doc) : doc;
    }
    static async deleteOne(req) {
      delete req.db;

      const { deletedCount } = await db.deleteOne(req);

      return deletedCount;
    }
    static async count(req) {
      const count = await db.count(req);

      return count;
    }
    _data() {
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
    async update(obj, shouldSave) {
      Object.assign(this, obj);

      if (shouldSave) {
        await this.save();
      }
    }
    async save() {
      if (!this._id) {
        const res = await db.insertOne(this._data());
        this._id = res.insertedId;
        return this._id;
      } else {
        await db.updateOne({ _id: this._id }, {
          $set: this._data(),
        }, { upsert: true });

        return this._id;
      }
    }
  }

  return Model;
};
