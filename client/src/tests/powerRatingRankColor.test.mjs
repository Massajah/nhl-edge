import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  POWER_RATING_RANK_COLOR_STOPS,
  getPowerRatingRankColor,
  normalizePowerRatingRank,
} from '../utils/powerRatingRankColor.js'

test('rank color maps the best, middle, and worst ranks to the intended stops', () => {
  assert.equal(getPowerRatingRankColor(1, 5), '#4fc981')
  assert.equal(getPowerRatingRankColor(3, 5), '#e4c44f')
  assert.equal(getPowerRatingRankColor(5, 5), '#e7656d')
})

test('equal league ranks always produce exactly equal colors', () => {
  const tiedRankColors = Array.from({ length: 4 }, () =>
    getPowerRatingRankColor(10, 32),
  )

  assert.equal(new Set(tiedRankColors).size, 1)
})

test('neighboring ranks progress continuously through interpolated colors', () => {
  const colors = [9, 10, 11].map((rank) =>
    getPowerRatingRankColor(rank, 32),
  )
  const rgbColors = colors.map((color) =>
    color
      .slice(1)
      .match(/.{2}/g)
      .map((channel) => Number.parseInt(channel, 16)),
  )

  assert.equal(new Set(colors).size, colors.length)
  assert.ok(colors.every((color) => /^#[0-9a-f]{6}$/.test(color)))
  assert.ok(
    rgbColors.slice(1).every((rgb, index) =>
      rgb.every(
        (channel, channelIndex) =>
          Math.abs(channel - rgbColors[index][channelIndex]) <= 16,
      ),
    ),
  )
  assert.ok(
    colors.every(
      (color) =>
        !POWER_RATING_RANK_COLOR_STOPS.some(
          ({ color: stopColor }) => color === stopColor,
        ),
    ),
  )
})

test('rank normalization uses the supplied team count instead of a fixed league size', () => {
  assert.equal(normalizePowerRatingRank(4, 7), 0.5)
  assert.equal(getPowerRatingRankColor(4, 7), '#e4c44f')
  assert.notEqual(getPowerRatingRankColor(4, 7), getPowerRatingRankColor(4, 32))
})

test('single-team and invalid rank inputs fail safely', () => {
  assert.equal(normalizePowerRatingRank(1, 1), 0)
  assert.equal(getPowerRatingRankColor(1, 1), '#4fc981')
  assert.equal(getPowerRatingRankColor(0, 32), null)
  assert.equal(getPowerRatingRankColor(33, 32), null)
  assert.equal(getPowerRatingRankColor(1, 0), null)
  assert.equal(getPowerRatingRankColor(Number.NaN, 32), null)
  assert.equal(getPowerRatingRankColor(1.5, 32), null)
})
