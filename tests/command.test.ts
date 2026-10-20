import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../lib/command';
import { parseChoice, normId } from '../lib/text';
import { guessMapping, toVoters } from '../lib/import';
import { buildWhere } from '../lib/db';

test('name search', () => {
  assert.deepEqual(parseCommand('పేరు రాము'), { field: 'name', value: 'రాము' });
  assert.deepEqual(parseCommand('రాము పేరు'), { field: 'name', value: 'రాము' });
  assert.deepEqual(parseCommand('శ్రీనివాస రెడ్డి'), { field: 'name', value: 'శ్రీనివాస రెడ్డి' });
});
test('field commands', () => {
  assert.deepEqual(parseCommand('ఓటరు ఐడి abc 123 4567'), { field: 'voterId', value: 'ABC1234567' });
  assert.deepEqual(parseCommand('ఇంటి నంబర్ ౧౨-౩'), { field: 'house', value: '12-3' });
  assert.deepEqual(parseCommand('పార్ట్ నంబర్ 45'), { field: 'part', value: '45' });
  assert.deepEqual(parseCommand('క్రమ సంఖ్య 210'), { field: 'serial', value: '210' });
  assert.deepEqual(parseCommand('తండ్రి పేరు వెంకయ్య'), { field: 'relation', value: 'వెంకయ్య' });
  assert.deepEqual(parseCommand('ABC1234567'), { field: 'voterId', value: 'ABC1234567' });
  assert.equal(parseCommand('   '), null);
});
test('choice', () => {
  assert.equal(parseChoice('మూడు'), 3);
  assert.equal(parseChoice('౨'), 2);
  assert.equal(parseChoice('రాము'), null);
  assert.equal(normId(' abc-12 3'), 'ABC123');
});
test('import mapping + validation', () => {
  const headers = ['S.No', 'పేరు', "Father's Name", 'House No', 'EPIC No', 'Part No'];
  const m = guessMapping(headers);
  assert.deepEqual([m.serial, m.name, m.relation, m.house, m.voterId, m.part], [0, 1, 2, 3, 4, 5]);
  const v = toVoters({ headers, rows: [['1', 'రాము', 'వెంకయ్య', '5', 'abc1', '2'], ['2', '', '', '', '', ''], ['3', 'రాము', 'వెంకయ్య', '5', 'ABC1', '2']] }, m);
  assert.equal(v.voters.length, 1); assert.equal(v.skipped, 1); assert.equal(v.duplicates, 1);
});
test('where clause is exact-match only', () => {
  const w = buildWhere({ house: ' 7-132 ', voterId: 'x1', name: 'ignored here' });
  assert.deepEqual(w.params, ['X1', '7-132']);
  assert.equal(buildWhere({}).sql, '1');
});
