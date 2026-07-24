import { installBrowserCoralie } from './install-coralie'

// Browser: installs BrowserCoralieHost.
// Android: returns immediately because the native bridge already exists.
installBrowserCoralie()
