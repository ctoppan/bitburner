// utils/contracter.js
// Based on https://github.com/danielyxie/bitburner/blob/master/src/data/codingcontracttypes.ts

const settings = {
  keys: {
    serverMap: "BB_SERVER_MAP",
  },
}

const RETRY_DELAY_MS = 25

function getItem(key) {
  const item = localStorage.getItem(key)
  return item ? JSON.parse(item) : undefined
}

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now()
  return new Date(ms).toLocaleTimeString()
}

function safeStringify(obj) {
  return JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
}

function convert2DArrayToString(arr) {
  const components = []
  arr.forEach(function (e) {
    let s = e.toString()
    s = ["[", s, "]"].join("")
    components.push(s)
  })
  return components.join(",").replace(/\s/g, "")
}

const codingContractTypesMetadata = [
  {
    name: "Find Largest Prime Factor",
    solver: function (data) {
      let fac = 2
      let n = data
      while (n > (fac - 1) * (fac - 1)) {
        while (n % fac === 0) {
          n = Math.round(n / fac)
        }
        ++fac
      }
      return n === 1 ? fac - 1 : n
    },
  },
  {
    name: "Subarray with Maximum Sum",
    solver: function (data) {
      const nums = data.slice()
      for (let i = 1; i < nums.length; i++) {
        nums[i] = Math.max(nums[i], nums[i] + nums[i - 1])
      }
      return Math.max.apply(Math, nums)
    },
  },
  {
    name: "Total Ways to Sum",
    solver: function (data) {
      const ways = [1]
      ways.length = data + 1
      ways.fill(0, 1)
      for (let i = 1; i < data; ++i) {
        for (let j = i; j <= data; ++j) {
          ways[j] += ways[j - i]
        }
      }
      return ways[data]
    },
  },
  {
    name: "Spiralize Matrix",
    solver: function (data) {
      const spiral = []
      const m = data.length
      const n = data[0].length
      let u = 0
      let d = m - 1
      let l = 0
      let r = n - 1
      let k = 0
      while (true) {
        for (let col = l; col <= r; col++) {
          spiral[k] = data[u][col]
          ++k
        }
        if (++u > d) break

        for (let row = u; row <= d; row++) {
          spiral[k] = data[row][r]
          ++k
        }
        if (--r < l) break

        for (let col = r; col >= l; col--) {
          spiral[k] = data[d][col]
          ++k
        }
        if (--d < u) break

        for (let row = d; row >= u; row--) {
          spiral[k] = data[row][l]
          ++k
        }
        if (++l > r) break
      }
      return spiral
    },
  },
  {
    name: "Array Jumping Game",
    solver: function (data) {
      const n = data.length
      let i = 0
      for (let reach = 0; i < n && i <= reach; ++i) {
        reach = Math.max(i + data[i], reach)
      }
      return i === n ? 1 : 0
    },
  },
  {
    name: "Merge Overlapping Intervals",
    solver: function (data) {
      const intervals = data.slice()
      intervals.sort(function (a, b) {
        return a[0] - b[0]
      })
      const result = []
      let start = intervals[0][0]
      let end = intervals[0][1]
      for (const interval of intervals) {
        if (interval[0] <= end) {
          end = Math.max(end, interval[1])
        } else {
          result.push([start, end])
          start = interval[0]
          end = interval[1]
        }
      }
      result.push([start, end])
      return convert2DArrayToString(result)
    },
  },
  {
    name: "Generate IP Addresses",
    solver: function (data) {
      const ret = []
      for (let a = 1; a <= 3; ++a) {
        for (let b = 1; b <= 3; ++b) {
          for (let c = 1; c <= 3; ++c) {
            for (let d = 1; d <= 3; ++d) {
              if (a + b + c + d === data.length) {
                const A = parseInt(data.substring(0, a), 10)
                const B = parseInt(data.substring(a, a + b), 10)
                const C = parseInt(data.substring(a + b, a + b + c), 10)
                const D = parseInt(data.substring(a + b + c, a + b + c + d), 10)
                if (A <= 255 && B <= 255 && C <= 255 && D <= 255) {
                  const ip = [A.toString(), ".", B.toString(), ".", C.toString(), ".", D.toString()].join("")
                  if (ip.length === data.length + 3) {
                    ret.push(ip)
                  }
                }
              }
            }
          }
        }
      }
      return ret
    },
  },
  {
    name: "Algorithmic Stock Trader I",
    solver: function (data) {
      let maxCur = 0
      let maxSoFar = 0
      for (let i = 1; i < data.length; ++i) {
        maxCur = Math.max(0, (maxCur += data[i] - data[i - 1]))
        maxSoFar = Math.max(maxCur, maxSoFar)
      }
      return maxSoFar.toString()
    },
  },
  {
    name: "Algorithmic Stock Trader II",
    solver: function (data) {
      let profit = 0
      for (let p = 1; p < data.length; ++p) {
        profit += Math.max(data[p] - data[p - 1], 0)
      }
      return profit.toString()
    },
  },
  {
    name: "Algorithmic Stock Trader III",
    solver: function (data) {
      let hold1 = Number.MIN_SAFE_INTEGER
      let hold2 = Number.MIN_SAFE_INTEGER
      let release1 = 0
      let release2 = 0
      for (const price of data) {
        release2 = Math.max(release2, hold2 + price)
        hold2 = Math.max(hold2, release1 - price)
        release1 = Math.max(release1, hold1 + price)
        hold1 = Math.max(hold1, price * -1)
      }
      return release2.toString()
    },
  },
  {
    name: "Algorithmic Stock Trader IV",
    solver: function (data) {
      const k = data[0]
      const prices = data[1]
      const len = prices.length
      if (len < 2) return 0

      if (k > len / 2) {
        let res = 0
        for (let i = 1; i < len; ++i) {
          res += Math.max(prices[i] - prices[i - 1], 0)
        }
        return res
      }

      const hold = []
      const rele = []
      hold.length = k + 1
      rele.length = k + 1

      for (let i = 0; i <= k; ++i) {
        hold[i] = Number.MIN_SAFE_INTEGER
        rele[i] = 0
      }

      for (let i = 0; i < len; ++i) {
        const cur = prices[i]
        for (let j = k; j > 0; --j) {
          rele[j] = Math.max(rele[j], hold[j] + cur)
          hold[j] = Math.max(hold[j], rele[j - 1] - cur)
        }
      }
      return rele[k]
    },
  },
  {
    name: "Minimum Path Sum in a Triangle",
    solver: function (data) {
      const n = data.length
      const dp = data[n - 1].slice()
      for (let i = n - 2; i > -1; --i) {
        for (let j = 0; j < data[i].length; ++j) {
          dp[j] = Math.min(dp[j], dp[j + 1]) + data[i][j]
        }
      }
      return dp[0]
    },
  },
  {
    name: "Unique Paths in a Grid I",
    solver: function (data) {
      const n = data[0]
      const m = data[1]
      const currentRow = []
      currentRow.length = n
      for (let i = 0; i < n; i++) currentRow[i] = 1
      for (let row = 1; row < m; row++) {
        for (let i = 1; i < n; i++) {
          currentRow[i] += currentRow[i - 1]
        }
      }
      return currentRow[n - 1]
    },
  },
  {
    name: "Unique Paths in a Grid II",
    solver: function (data) {
      const obstacleGrid = []
      obstacleGrid.length = data.length
      for (let i = 0; i < obstacleGrid.length; ++i) {
        obstacleGrid[i] = data[i].slice()
      }

      for (let i = 0; i < obstacleGrid.length; i++) {
        for (let j = 0; j < obstacleGrid[0].length; j++) {
          if (obstacleGrid[i][j] == 1) {
            obstacleGrid[i][j] = 0
          } else if (i == 0 && j == 0) {
            obstacleGrid[0][0] = 1
          } else {
            obstacleGrid[i][j] =
              (i > 0 ? obstacleGrid[i - 1][j] : 0) +
              (j > 0 ? obstacleGrid[i][j - 1] : 0)
          }
        }
      }
      return obstacleGrid[obstacleGrid.length - 1][obstacleGrid[0].length - 1]
    },
  },
  {
    name: "Sanitize Parentheses in Expression",
    solver: function (data) {
      let left = 0
      let right = 0
      const res = []

      for (let i = 0; i < data.length; ++i) {
        if (data[i] === "(") {
          ++left
        } else if (data[i] === ")") {
          left > 0 ? --left : ++right
        }
      }

      function dfs(pair, index, left, right, s, solution, res) {
        if (s.length === index) {
          if (left === 0 && right === 0 && pair === 0) {
            for (let i = 0; i < res.length; i++) {
              if (res[i] === solution) return
            }
            res.push(solution)
          }
          return
        }

        if (s[index] === "(") {
          if (left > 0) dfs(pair, index + 1, left - 1, right, s, solution, res)
          dfs(pair + 1, index + 1, left, right, s, solution + s[index], res)
        } else if (s[index] === ")") {
          if (right > 0) dfs(pair, index + 1, left, right - 1, s, solution, res)
          if (pair > 0) dfs(pair - 1, index + 1, left, right, s, solution + s[index], res)
        } else {
          dfs(pair, index + 1, left, right, s, solution + s[index], res)
        }
      }

      dfs(0, 0, left, right, data, "", res)
      return res
    },
  },
  {
    name: "Find All Valid Math Expressions",
    solver: function (data) {
      const num = data[0]
      const target = data[1]

      function helper(res, path, num, target, pos, evaluated, multed) {
        if (pos === num.length) {
          if (target === evaluated) {
            res.push(path)
          }
          return
        }

        for (let i = pos; i < num.length; ++i) {
          if (i != pos && num[pos] == "0") break
          const cur = parseInt(num.substring(pos, i + 1))
          if (pos === 0) {
            helper(res, path + cur, num, target, i + 1, cur, cur)
          } else {
            helper(res, path + "+" + cur, num, target, i + 1, evaluated + cur, cur)
            helper(res, path + "-" + cur, num, target, i + 1, evaluated - cur, -cur)
            helper(res, path + "*" + cur, num, target, i + 1, evaluated - multed + multed * cur, multed * cur)
          }
        }
      }

      if (num == null || num.length === 0) return []
      const result = []
      helper(result, "", num, target, 0, 0, 0)
      return result
    },
  },
]

const knownContractTypes = new Set(codingContractTypesMetadata.map((x) => x.name))

function findSolver(type) {
  return codingContractTypesMetadata.find((entry) => entry.name === type)
}

function findAnswer(contract) {
  const solverEntry = findSolver(contract.type)
  if (!solverEntry) return null
  return solverEntry.solver(contract.data)
}

function getAttemptVariants(answer) {
  const variants = []
  const seen = new Set()

  function addVariant(value) {
    const key = safeStringify(value)
    if (!seen.has(key)) {
      seen.add(key)
      variants.push(value)
    }
  }

  addVariant(answer)

  if (Array.isArray(answer)) {
    addVariant(JSON.stringify(answer))
    addVariant(convert2DArrayToString(answer))
  } else if (typeof answer === "number") {
    addVariant(answer.toString())
  } else if (typeof answer === "bigint") {
    addVariant(answer.toString())
  }

  return variants
}

async function attemptWithRetry(ns, contract, answer) {
  const variants = getAttemptVariants(answer)

  for (let i = 0; i < variants.length; i++) {
    const candidate = variants[i]
    const reward = ns.codingcontract.attempt(
      candidate,
      contract.contract,
      contract.hostname,
      { returnReward: true }
    )

    if (reward) {
      return {
        success: true,
        reward,
        attemptIndex: i,
        answerUsed: candidate,
      }
    }

    if (i < variants.length - 1) {
      await ns.sleep(RETRY_DELAY_MS)
    }
  }

  return {
    success: false,
    reward: "",
    attemptIndex: variants.length - 1,
    answerUsed: variants[variants.length - 1],
  }
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting contracter.js`)

  const hostname = ns.getHostname()
  if (hostname !== "home") {
    throw new Error("Run the script from home")
  }

  const serverMap = getItem(settings.keys.serverMap)
  if (!serverMap || !serverMap.servers) {
    ns.tprint(`[${localeHHMMSS()}] ERROR: Missing server map in localStorage key ${settings.keys.serverMap}`)
    return
  }

  const contractsDb = []
  const skippedUnknown = []

  Object.keys(serverMap.servers).forEach((targetHost) => {
    const files = ns.ls(targetHost)
    if (!files || !files.length) return

    const contracts = files.filter((file) => file.endsWith(".cct"))
    if (!contracts.length) return

    contracts.forEach((contractFile) => {
      const type = ns.codingcontract.getContractType(contractFile, targetHost)
      const contractData = {
        contract: contractFile,
        hostname: targetHost,
        type,
        data: ns.codingcontract.getData(contractFile, targetHost),
      }

      if (!knownContractTypes.has(type)) {
        skippedUnknown.push({
          contract: contractFile,
          hostname: targetHost,
          type,
        })
        return
      }

      contractsDb.push(contractData)
    })
  })

  if (skippedUnknown.length) {
    for (const skipped of skippedUnknown) {
      ns.tprint(
        `[${localeHHMMSS()}] Skipping unsupported contract type "${skipped.type}" for ${skipped.contract} on ${skipped.hostname}`
      )
    }
  }

  if (!contractsDb.length) {
    ns.tprint(`[${localeHHMMSS()}] No supported contracts found.`)
    return
  }

  for (let i = 0; i < contractsDb.length; i++) {
    const contract = contractsDb[i]
    let answer = null

    try {
      answer = findAnswer(contract)
    } catch (err) {
      ns.tprint(
        `[${localeHHMMSS()}] Solver crashed for ${contract.contract} on ${contract.hostname} (${contract.type}): ${String(err)}`
      )
      await ns.sleep(10)
      continue
    }

    if (answer == null) {
      ns.tprint(
        `[${localeHHMMSS()}] No answer generated for ${contract.contract} on ${contract.hostname} (${contract.type})`
      )
      await ns.sleep(10)
      continue
    }

    const result = await attemptWithRetry(ns, contract, answer)

    if (result.success) {
      const retryNote = result.attemptIndex > 0 ? ` (retry ${result.attemptIndex})` : ""
      ns.tprint(
        `[${localeHHMMSS()}] Solved ${contract.contract} on ${contract.hostname}${retryNote}. ${result.reward}`
      )
    } else {
      ns.tprint(
        `[${localeHHMMSS()}] Failed ${contract.contract} on ${contract.hostname} after retries. type=${contract.type} answer=${safeStringify(answer)}`
      )
    }

    await ns.sleep(10)
  }
}