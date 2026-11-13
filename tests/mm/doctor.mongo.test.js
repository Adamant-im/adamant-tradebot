'use strict';

/* global jest, describe, test, expect, beforeEach */

jest.mock('../../modules/mm/mongo-probe', () => ({
  ...jest.requireActual('../../modules/mm/mongo-probe'),
  probeMongo: jest.fn(),
}));

const { probeMongo } = require('../../modules/mm/mongo-probe');
const { checkMongo } = require('../../modules/mm/commands/doctor');

const DB_URL = 'mongodb://bot:s3cr3t@db1.example.net:27017,db2.example.net:27017/?replicaSet=rs0';
const USER_CONFIG = {
  db: {
    name: 'tradebotdb',
    url: DB_URL,
  },
};

describe('mm doctor MongoDB check', () => {
  beforeEach(() => {
    probeMongo.mockReset();
  });

  test('reports a connected database without the password', async () => {
    probeMongo.mockResolvedValue({
      url: DB_URL,
      name: 'tradebotdb',
      dataSize: 5 * 1024 * 1024,
      displaySize: '5 MB',
    });

    const section = await checkMongo({ mode: 'npm' }, USER_CONFIG);

    expect(section.status).toBe('OK');
    expect(section.messages[0])
        .toBe('Connected to mongodb://bot:****@db1.example.net:27017,db2.example.net:27017/?replicaSet=rs0, database tradebotdb, size ~5 MB');
    expect(JSON.stringify(section)).not.toContain('s3cr3t');
  });

  test('reports a failed connection without the password, also in the error text', async () => {
    probeMongo.mockRejectedValue(new Error(`Server selection timed out for ${DB_URL}`));

    const section = await checkMongo({ mode: 'npm' }, USER_CONFIG);

    expect(section.status).toBe('FAILED');
    expect(section.messages[0]).toBe('Could not connect to mongodb://bot:****@db1.example.net:27017,db2.example.net:27017/?replicaSet=rs0');
    expect(JSON.stringify(section)).not.toContain('s3cr3t');
  });
});
