module.exports = (db) => {
  return class {
    constructor(data = {}, isSave) {
      this.db = db;
      Object.assign(this, data);
      if (isSave) {
        this.save();
      }
    }
    static get db() {
      return db;
    }
    static find(a) { // return Array
      return new Promise((resolve, reject) => {
        this.db.find(a).toArray((err, data) => {
          resolve(data.map((d)=>new this(d)));
        });
      });
    }
    static aggregate(a) { // return Array
      return new Promise((resolve, reject) => {
        this.db.aggregate(a).toArray((err, data) => {
          resolve(data.map((d)=>new this(d)));
        });
      });
    }
    static findOne(a) {
      return new Promise((resolve, reject) => {
        db.findOne(a).then((doc, b) => {
          if (!doc) {
            resolve(doc);
          } else {
            resolve(new this(doc));
          }
        });
      });
    }
    static deleteOne(a) {
      return new Promise((resolve, reject) => {
        delete a.db;
        db.deleteOne(a).then((res) => {
          resolve(res.deletedCount);
        });
      });
    }
    static count(a) {
      return new Promise((resolve, reject) => {
        db.count(a).then((count) => {
          resolve(count);
        });
      });
    }
    _data() {
      const data = {};
      for (const field in this) {
        if (!['db', '_id'].includes(field)) {
          data[field] = this[field];
        }
      }
      return data;
    }
    async update(obj, isSave) {
      Object.assign(this, obj);
      if (isSave) {
        await this.save();
      }
    }
    save() {
      return new Promise((resolve, reject) => {
        if (!this._id) {
          db.insertOne(this._data(), (err, res) => {
            this._id = res.insertedId;
            resolve(this._id);
          });
        } else {
          db.updateOne({ _id: this._id }, {
            $set: this._data(),
          }, { upsert: true }).then(() => {
            resolve(this._id);
          });
        }
      });
    }
  };
};
