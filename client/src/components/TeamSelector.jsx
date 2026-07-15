const divisionOrder = ['Atlantic', 'Metropolitan', 'Central', 'Pacific']

function TeamSelector({ id, label, teams, value, disabledTeamId, onChange }) {
  const teamsByDivision = divisionOrder.map((division) => ({
    division,
    teams: teams.filter((team) => team.division === division),
  }))

  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {teamsByDivision.map((group) => (
          <optgroup key={group.division} label={group.division}>
            {group.teams.map((team) => (
              <option
                key={team.id}
                value={team.id}
                disabled={team.id === disabledTeamId}
              >
                {team.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

export default TeamSelector
