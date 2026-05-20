import { describe, expect, it } from 'vitest'
import { makeDashboardData } from '../dashboard-data'

describe('makeDashboardData', () => {
  it('builds a complete default dashboard data fixture', () => {
    const data = makeDashboardData()

    expect(data.connection.isConnected).toBe(true)
    expect(data.dbStats?.activities.day).toBe(3)
    expect(data.gatewayHealthStatus).toBe('good')
  })

  it('deep-merges focused overrides without repeating the full fixture', () => {
    const data = makeDashboardData({
      connection: { latency: 250 },
      dbStats: { activities: { day: 9 } },
      hermesCronJobCount: 4,
    })

    expect(data.connection.isConnected).toBe(true)
    expect(data.connection.latency).toBe(250)
    expect(data.dbStats?.activities.day).toBe(9)
    expect(data.dbStats?.tasks.total).toBe(0)
    expect(data.hermesCronJobCount).toBe(4)
  })
})
