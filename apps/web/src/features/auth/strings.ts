const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** Seconds as m:ss, e.g. 0:27. */
const formatCountdown = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;

export const strings = {
  paperNote: 'Paper trading with ₹10,00,000 of virtual cash. No real money moves.',
  explore: 'Explore the markets without logging in',
  guide: 'Documentation: how nthstock works',
  demo: {
    label: 'Try demo',
    starting: 'Starting demo…',
    /** The reviewer link could not open its position (NSTOCK-0444): the demo opens without it. */
    noPosition: {
      title: 'The demo position did not open',
      description: 'Place a trade with Buy to see it on the chart.',
    },
  },

  mobile: {
    title: 'Log in to nthstock',
    body: 'Enter your mobile number and we will send you a one-time password.',
    unlockTitle: 'Unlock your PIN',
    unlockBody: 'Verify your mobile number with an OTP to unlock PIN login.',
    label: 'Mobile number',
    prefix: '+91',
    hint: 'Indian number (+91): 10 digits, starting 6 to 9',
    consent:
      'I agree that nthstock may use my mobile number to log me in and keep my account secure, under the Digital Personal Data Protection Act, 2023.',
    consentRequired: 'Tick the box to agree before we send an OTP.',
    submit: 'Get OTP',
    untrustedDevice: 'PIN login is not set up on this browser any more. Log in with an OTP.',
  },

  otp: {
    title: 'Enter the OTP',
    sentTo: (mobile: string) => `We sent a 6-digit code to +91 ${mobile}.`,
    label: 'One-time password',
    changeNumber: 'Change number',
    verify: 'Verify OTP',
    resend: 'Resend OTP',
    resendIn: (seconds: number) => `Resend OTP in ${formatCountdown(seconds)}`,
    resent: 'We sent a new OTP.',
    devHint: (otp: string) => `Mock mode: the OTP is always ${otp}.`,
    wrong: (attemptsLeft: number | undefined) =>
      attemptsLeft === undefined
        ? 'Incorrect OTP. Please try again.'
        : `Incorrect OTP. ${plural(attemptsLeft, 'attempt', 'attempts')} left.`,
    tooManyAttempts: 'Too many wrong attempts. Request a new OTP.',
    expired: 'This OTP has expired. Request a new one.',
    captchaLabel: 'I am not a robot (mock CAPTCHA)',
    captchaRequired: 'Tick the CAPTCHA box, then enter the OTP again.',
  },

  deleted: {
    title: 'Account deletion in progress',
    body: (date: string) =>
      `This account is being deleted. Its data is erased for good on ${date}; until then this mobile number cannot log in. After that, it can sign up again as a new account.`,
    useAnother: 'Use another number',
    notice: (date: string) =>
      `Your account is deleted and you are logged out everywhere. Its data is erased for good on ${date}.`,
  },

  pinSetup: {
    title: 'Set a login PIN',
    body: 'Next time on this browser, log in with a 4-digit PIN instead of an OTP.',
    pinLabel: 'New PIN',
    confirmLabel: 'Confirm PIN',
    pinRequired: 'Enter 4 digits.',
    mismatch: 'PINs do not match.',
    submit: 'Set PIN',
    skip: 'Skip for now',
  },

  pinEntry: {
    title: (name: string | null) => (name ? `Welcome back, ${name}` : 'Welcome back'),
    body: (mobile: string) => `Enter your 4-digit PIN for +91 ${mobile}.`,
    label: 'PIN',
    submit: 'Log in',
    wrong: (attemptsLeft: number | undefined) =>
      attemptsLeft === undefined
        ? 'Incorrect PIN. Please try again.'
        : `Incorrect PIN. ${plural(attemptsLeft, 'attempt', 'attempts')} left.`,
    useOtp: 'Log in with OTP instead',
  },

  totp: {
    title: 'Two-factor authentication',
    body: 'Enter the 6-digit code from your authenticator app.',
    label: 'Authentication code',
    recoveryTitle: 'Use a recovery code',
    recoveryBody: 'Enter one of the recovery codes you saved when you turned on two-factor.',
    recoveryLabel: 'Recovery code',
    recoveryPlaceholder: 'ABCD-EFGH-JKLM-NPQR',
    verify: 'Verify',
    useRecovery: 'Use a recovery code instead',
    useCode: 'Use the authenticator app instead',
    wrong: (attemptsLeft: number | undefined) =>
      attemptsLeft === undefined
        ? 'That code is not right. Try again.'
        : `That code is not right. ${plural(attemptsLeft, 'attempt', 'attempts')} left.`,
    ended: 'This sign-in has ended after too many wrong codes, or it expired. Log in again.',
    startAgain: 'Log in again',
    recoveryInvalid: 'Enter the 16-character code, for example ABCD-EFGH-JKLM-NPQR.',
  },

  stepUp: {
    title: 'Confirm it is you',
    body: 'For your security, confirm your identity before changing security settings.',
    pinLabel: 'Your PIN',
    otpLabel: 'One-time password',
    otpSent: (masked: string) => `We sent an OTP to +91 ${masked}.`,
    totpLabel: 'Code from your authenticator app',
    useOtp: 'Use an OTP instead',
    usePin: 'Use your PIN instead',
    sendOtp: 'Send OTP',
    confirm: 'Confirm',
    cancel: 'Cancel',
    devHint: (otp: string) => `Mock mode: the OTP is always ${otp}.`,
    wrongPin: (attemptsLeft: number | undefined) =>
      attemptsLeft === undefined
        ? 'Incorrect PIN. Please try again.'
        : `Incorrect PIN. ${plural(attemptsLeft, 'attempt', 'attempts')} left.`,
    pinLocked: 'Too many wrong PINs. Use an OTP instead.',
    wrongOtp: 'Incorrect OTP. Please try again.',
    otpExpired: 'This OTP has expired. Send a new one.',
    wrongTotp: 'That authenticator code is not right. Wait for the next code and try again.',
    totpRequired: 'Enter the code from your authenticator app too.',
  },

  locked: {
    title: 'PIN locked',
    body: 'Too many wrong PINs. Unlock with an OTP sent to your mobile number to continue.',
    unlock: 'Unlock with OTP',
  },

  profile: {
    // The visible initials lead the label so the accessible name contains them (WCAG 2.5.3).
    menu: (name: string, shownInitials?: string) =>
      shownInitials ? `${shownInitials}, account: ${name}` : `Account: ${name}`,
    defaultName: 'nthstock investor',
    mobile: (masked: string) => `+91 ${masked}`,
    kyc: {
      NOT_STARTED: 'KYC not started',
      PENDING: 'KYC pending',
      VERIFIED: 'KYC verified',
    },
    kycNote: 'Mock KYC for paper trading',
    security: 'Security',
    logOut: 'Log out',
    logIn: 'Log in',
    accountSignedOut: 'Account',
    loading: 'Checking your session',
  },

  errors: {
    rateLimited: (seconds: number | undefined) =>
      seconds === undefined
        ? 'Too many requests. Please wait a moment and try again.'
        : `Please wait ${plural(seconds, 'second', 'seconds')} before requesting another OTP.`,
    network: 'We could not reach nthstock. Check your connection and try again.',
    generic: 'Something went wrong. Please try again.',
  },
} as const;
