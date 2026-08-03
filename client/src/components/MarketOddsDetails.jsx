import { useId, useMemo, useState } from 'react'
import { sortBookmakerOdds } from '../utils/marketOdds.js'

const formatOdds = (value) => {
  const numberValue = Number(value)

  return Number.isFinite(numberValue) && numberValue > 1
    ? numberValue.toFixed(2)
    : '--'
}

const formatUtcTime = (value) => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')} UTC`
}

function MarketOddsDetails({
  bookmakers = [],
  buttonLabel = 'View Market Odds',
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [sortBy, setSortBy] = useState('home')
  const sortControlName = useId()
  const sortedBookmakers = useMemo(
    () => sortBookmakerOdds(bookmakers, sortBy),
    [bookmakers, sortBy],
  )

  if (bookmakers.length === 0) {
    return null
  }

  return (
    <div className="market-odds-details">
      <button
        className="market-odds-details-toggle"
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        {isOpen ? 'Hide Market Odds' : buttonLabel}
      </button>

      {isOpen ? (
        <div className="market-odds-details-panel">
          <fieldset className="market-odds-sort-controls">
            <legend>Sort by:</legend>
            {[
              ['home', 'Home Odds'],
              ['away', 'Away Odds'],
              ['bookmaker', 'Bookmaker'],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  checked={sortBy === value}
                  name={`market-odds-sort-${sortControlName}`}
                  type="radio"
                  value={value}
                  onChange={() => setSortBy(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <div className="market-odds-table-scroll">
            <table className="market-odds-table">
              <thead>
                <tr>
                  <th>Bookmaker</th>
                  <th>Away Odds</th>
                  <th>Home Odds</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {sortedBookmakers.map((bookmaker) => (
                  <tr
                    className={bookmaker.enabled ? '' : 'disabled-bookmaker'}
                    key={bookmaker.bookmakerKey}
                  >
                    <td>
                      {bookmaker.bookmakerTitle}
                      {!bookmaker.enabled ? <small>Disabled</small> : null}
                    </td>
                    <td>{formatOdds(bookmaker.awayOdds)}</td>
                    <td>{formatOdds(bookmaker.homeOdds)}</td>
                    <td>{formatUtcTime(bookmaker.lastUpdate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default MarketOddsDetails
