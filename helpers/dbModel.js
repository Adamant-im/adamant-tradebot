module.exports = (db) => {
  class Model {
    constructor(data = {}, shouldSave) {
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
