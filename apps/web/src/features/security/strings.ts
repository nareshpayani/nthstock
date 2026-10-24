export const strings = {
  title: 'Security',
  description:
    'Protect your nthstock account with two-factor authentication, and see where you are logged in.',

  twoFactor: {
    title: 'Two-factor authentication',
    body: 'After your PIN or OTP, nthstock also asks for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password).',
    on: 'On',
    off: 'Off',
    statusLabel: (on: boolean) => `Two-factor authentication is ${on ? 'on' : 'off'}`,
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    newCodes: 'New recovery codes',
    turnedOn: 'Two-factor authentication is on',
    turnedOnBody: 'You will be asked for a code from your authenticator app when you log in.',
    turnedOff: 'Two-factor authentication is off',
    turnedOffBody: 'Logging in now needs only your PIN or an OTP.',
    newCodesDone: 'New recovery codes are ready',
  },

  setup: {
    title: 'Turn on two-factor authentication',
    scanTitle: '1. Add nthstock to your authenticator app',
    scanBody: 'Scan the QR code with the app, or enter the setup key by hand.',
    qrLabel: 'QR code for your authenticator app',
    qrLoading: 'Drawing the QR code',
    setupKey: 'Setup key',
    copyKey: 'Copy key',
    copied: 'Copied',
    openApp: 'Open in an authenticator app on this phone',
    next: 'Next',
    confirmTitle: '2. Enter the code the app shows',
    codeLabel: 'Code from your authenticator app',
    confirm: 'Turn on',
    back: 'Back',
    codesTitle: '3. Save your recovery codes',
    starting: 'Preparing your setup key',
    expired: 'This setup has expired. Start again.',
  },

  codes: {
    body: 'If you lose your phone, each of these codes logs you in once. Keep them somewhere safe. They are shown only now.',
    listLabel: 'Recovery codes',
    copy: 'Copy codes',
    download: 'Download .txt',
    saved: 'I have saved these codes',
    done: 'Done',
    fileName: 'nthstock-recovery-codes.txt',
    fileHeader: (masked: string) =>
      `nthstock recovery codes for +91 ${masked}\nEach code works once. Keep this file somewhere safe.\n`,
    copyFailed: 'Could not copy. Select the codes and copy them by hand.',
  },

  turnOff: {
    title: 'Turn off two-factor authentication',
    body: 'Enter a code from your authenticator app, or a recovery code if you no longer have the app.',
    codeLabel: 'Code from your authenticator app',
    recoveryLabel: 'Recovery code',
    useRecovery: 'Use a recovery code instead',
    useCode: 'Use the authenticator app instead',
    confirm: 'Turn off',
    cancel: 'Cancel',
  },

  regenerate: {
    title: 'Get new recovery codes',
    body: 'Your old recovery codes stop working. Enter a code from your authenticator app to continue.',
    codeLabel: 'Code from your authenticator app',
    confirm: 'Get new codes',
    cancel: 'Cancel',
  },

  sessions: {
    title: 'Where you are logged in',
    body: 'Every browser and phone with a session on your account. Log out any you do not recognise.',
    loading: 'Loading your sessions',
    loadFailed: 'Could not load your sessions.',
    retry: 'Try again',
    thisDevice: 'This device',
    trusted: 'Trusted',
    trustedHint: 'Can log in with your PIN',
    signedIn: (when: string) => `Logged in ${when}`,
    lastActive: (when: string) => `Last active ${when}`,
    activeNow: 'Active now',
    logOut: 'Log out',
    logOutLabel: (device: string) => `Log out ${device}`,
    logOutOthers: 'Log out all other devices',
    onlyThis: 'You are logged in only on this device.',
    confirmOneTitle: 'Log out this device?',
    confirmOneBody: (device: string) =>
      `${device} is logged out at once. Anyone using it has to log in again with an OTP.`,
    confirmOthersTitle: 'Log out all other devices?',
    confirmOthersBody: (count: number) =>
      `${String(count)} other ${count === 1 ? 'device is' : 'devices are'} logged out at once. This device stays logged in.`,
    offerTitle: 'Log out your other devices too?',
    offerBody: (count: number) =>
      `Your security settings changed. ${String(count)} other ${count === 1 ? 'device is' : 'devices are'} still logged in with the old settings.`,
    notNow: 'Not now',
    cancel: 'Cancel',
    loggedOutOne: (device: string) => `${device} is logged out`,
    loggedOutOthers: (count: number) =>
      count === 0
        ? 'No other devices were logged in'
        : `${String(count)} other ${count === 1 ? 'device' : 'devices'} logged out`,
    gone: 'That session had already ended.',
  },

  errors: {
    wrongCode: 'That code is not right. Wait for the next code in the app and try again.',
    recoveryInvalid: 'Enter the 16-character code, for example ABCD-EFGH-JKLM-NPQR.',
    generic: 'Something went wrong. Please try again.',
    network: 'We could not reach nthstock. Check your connection and try again.',
  },
} as const;
