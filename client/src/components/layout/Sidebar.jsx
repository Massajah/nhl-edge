import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import NavItem from './NavItem.jsx'

function Sidebar({
  activePage,
  isCollapsed,
  onCloseMobile,
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
