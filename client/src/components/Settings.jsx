import { KeyRound, Mail, UserCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

const providerLabels = {
  both: 'Email and Google',
  google: 'Google',
  local: 'Email/password',
}

const getProviderLabel = (provider) =>
  providerLabels[provider] ?? 'Email/password'

function Settings() {
  const { user } = useAuth()

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Profile</p>
            <h2>Account</h2>
          </div>
        </div>

        <div className="profile-summary">
          {user?.profileImage ? (
            <img
              className="profile-avatar"
              src={user.profileImage}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <UserCircle
              className="profile-avatar-icon"
              aria-hidden="true"
              strokeWidth={1.8}
            />
          )}
          <div>
            <strong>{user?.name || user?.email || 'NHL Edge user'}</strong>
            <span>{user?.email || 'Email unavailable'}</span>
          </div>
        </div>

        <div className="profile-grid">
          <div className="profile-field">
            <UserCircle aria-hidden="true" size={19} strokeWidth={2} />
            <span>Name</span>
            <strong>{user?.name || 'Not provided'}</strong>
          </div>
          <div className="profile-field">
            <Mail aria-hidden="true" size={19} strokeWidth={2} />
            <span>Email</span>
            <strong>{user?.email || 'Not provided'}</strong>
          </div>
          <div className="profile-field">
            <KeyRound aria-hidden="true" size={19} strokeWidth={2} />
            <span>Authentication provider</span>
            <strong>{getProviderLabel(user?.authProvider)}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Settings
