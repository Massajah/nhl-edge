import { Menu } from 'lucide-react'

function MobileHeader({ currentPageTitle, isDemoSandbox, onOpenSidebar }) {
  return (
    <header className="mobile-header">
      <button
        className="mobile-menu-button"
        type="button"
        aria-label="Open navigation"
        onClick={onOpenSidebar}
      >
        <Menu aria-hidden="true" size={22} strokeWidth={2.2} />
      </button>
      <div className="mobile-header-title">
        <span>
          NHL EDGE
          {isDemoSandbox ? <em>DEMO</em> : null}
        </span>
        <strong>{currentPageTitle}</strong>
      </div>
    </header>
  )
}

export default MobileHeader
