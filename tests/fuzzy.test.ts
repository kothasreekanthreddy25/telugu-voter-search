import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameDistance, skeleton } from '../lib/fuzzy';

// Real strings: left is what the PDF text layer yields for the voter line (corrupted), right is what is printed.
const layer = (s: string) => skeleton(s);

test('corrupted PDF text still matches the spoken name', () => {
  const stored = layer('వర' + '\u0000ప' + 'సాద్' + 'ఆలూరి'); // printed: వర ప్రసాద్ ఆలూరి
  assert.ok(nameDistance(stored, 'వర ప్రసాద్ ఆలూరి') <= 2);
  assert.ok(nameDistance(stored, 'ప్రసాద్') <= 1);
  assert.ok(nameDistance(stored, 'ఆలూరి') === 0);
});
test('different names do not match', () => {
  const stored = layer('బాలరాజు ఆలూరి');
  assert.equal(nameDistance(stored, 'సీతా మహాలక్ష్మి'), Infinity);
  assert.equal(nameDistance(stored, ''), Infinity);
});
test('look-alike letters are folded', () => {
  assert.equal(skeleton('శ్రీనివాస్'), skeleton('స్రీనివాస్'));
  assert.equal(skeleton('భాస్కర్'), skeleton('బాస్కర్'));
});
test('short words need an exact hit', () => {
  assert.equal(nameDistance(skeleton('రాము'), 'సీత'), Infinity);
  assert.equal(nameDistance(skeleton('రాము'), 'రాము'), 0);
});
