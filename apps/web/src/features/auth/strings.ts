const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** Seconds as m:ss, e.g. 0:27. */
export const formatCountdown = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;

export const strings = {
  paperNote: 'Paper trading with ₹10,00,000 of virtual cash. No real money moves.',
  explore: 'Explore the markets without logging in',

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

  locked: {
    title: 'PIN locked',
    body: 'Too many wrong PINs. Unlock with an OTP sent to your mobile number to continue.',
    unlock: 'Unlock with OTP',
  },

  profile: {
    menu: (name: string) => `Account: ${name}`,
    defaultName: 'nthstock investor',
    mobile: (masked: string) => `+91 ${masked}`,
    kyc: {
      NOT_STARTED: 'KYC not started',
      PENDING: 'KYC pending',
      VERIFIED: 'KYC verified',
    },
    kycNote: 'Mock KYC for paper trading',
    logOut: 'Log out',
    logIn: 'Log in',
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
