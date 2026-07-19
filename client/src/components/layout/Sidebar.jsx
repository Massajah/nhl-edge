import { LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import NavItem from './NavItem.jsx'

const getInitials = (user) => {
  const source = user?.name || user?.email || 'NE'
  const parts = source
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) {
    return 'NE'
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function Sidebar({
  activePage,
  authUser,
  isCollapsed,
  onCloseMobile,
  onLogout,
  onNavigate,
  onToggleCollapse,
  primaryItems,
  utilityItems = [],
}) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-brand-row">
        <div className="sidebar-brand" aria-label="NHL EDGE">
          <span className="sidebar-brand-mark">NE</span>
          <span className="sidebar-brand-title">NHL EDGE</span>
        </div>
        <button
          className="sidebar-mobile-close"
          type="button"
          aria-label="Close navigation"
          onClick={onCloseMobile}
        >
          <X aria-hidden="true" size={20} strokeWidth={2.2} />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main">
        <div className="sidebar-nav-group">
          {primaryItems.map((item) => (
            <NavItem
              Icon={item.Icon}
              isActive={activePage === item.id}
              isCollapsed={isCollapsed}
              item={item}
              key={item.id}
              onSelect={onNavigate}
            />
          ))}
        </div>

        <div className="sidebar-utility-section">
          {utilityItems.length > 0 ? (
            <div className="sidebar-nav-group">
              {utilityItems.map((item) => (
                <NavItem
                  Icon={item.Icon}
                  isActive={activePage === item.id}
                  isCollapsed={isCollapsed}
                  item={item}
                  key={item.id}
                  onSelect={onNavigate}
                />
              ))}
            </div>
          ) : null}

          <div className="sidebar-user-card">
            {authUser?.profileImage ? (
              <img
                className="sidebar-user-avatar"
                src={authUser.profileImage}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="sidebar-user-avatar">{getInitials(authUser)}</span>
            )}
            <div className="sidebar-user-copy">
              <strong>{authUser?.name || 'NHL Edge user'}</strong>
              <span>{authUser?.email || 'Signed in'}</span>
            </div>
          </div>

          <button
            className="sidebar-logout-button"
            type="button"
            aria-label="Logout"
            title={isCollapsed ? 'Logout' : undefined}
            onClick={onLogout}
          >
            <LogOut aria-hidden="true" size={19} strokeWidth={2.1} />
            <span>Logout</span>
          </button>

          <button
            className="sidebar-collapse-button"
            type="button"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleCollapse}
          >
            {isCollapsed ? (
              <PanelLeftOpen aria-hidden="true" size={20} strokeWidth={2.1} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={20} strokeWidth={2.1} />
            )}
            <span className="sidebar-collapse-label">
              {isCollapsed ? 'Expand' : 'Collapse'}
            </span>
          </button>
        </div>
      </nav>
    </aside>
  )
}

export default Sidebar
