function NavItem({ Icon, isActive, isCollapsed, item, onSelect }) {
  return (
    <button
      className={`nav-item ${isActive ? 'active' : ''}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-label={isCollapsed ? item.label : undefined}
      title={isCollapsed ? item.label : undefined}
      onClick={() => onSelect(item.id)}
    >
      <Icon className="nav-item-icon" aria-hidden="true" strokeWidth={2} />
      <span className="nav-item-label">{item.label}</span>
      {isCollapsed ? (
        <span className="nav-item-tooltip" role="tooltip">
          {item.label}
        </span>
      ) : null}
    </button>
  )
}

export default NavItem
