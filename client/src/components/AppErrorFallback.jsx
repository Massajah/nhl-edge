function AppErrorFallback() {
  return (
    <main className="auth-loading-screen" role="alert">
      <span className="sidebar-brand-mark">NE</span>
      <div>
        <p className="eyebrow">NHL Edge</p>
        <strong>Something went wrong</strong>
        <p>Refresh the page to try again.</p>
      </div>
    </main>
  )
}

export default AppErrorFallback
