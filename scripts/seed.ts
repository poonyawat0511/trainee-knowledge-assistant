import { seedAdmin } from '../src/modules/auth/infrastructure/seed-admin'

seedAdmin()
  .then(() => {
    console.log('Seeded admin user (admin/admin123)')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
