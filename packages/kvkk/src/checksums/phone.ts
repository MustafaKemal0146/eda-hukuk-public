// TR telefon sağlaması (026 §6.2): ulusal 10 hane; alan kodu 2xx-4xx veya cep 5xx. 0800/0850 gibi
// hizmet hatları kişisel değildir (desen 8xx alan kodunu zaten almaz).

export function isValidPhone(national10: string): boolean {
  return /^[2-5][0-9]{9}$/u.test(national10);
}
