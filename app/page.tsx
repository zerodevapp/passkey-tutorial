"use client"

import {
    createKernelAccount,
    createKernelAccountClient,
    createZeroDevPaymasterClient,
    AccountNotFoundError,
    KernelValidator,
} from "@zerodev/sdk"
import {
    PasskeyValidatorContractVersion,
    WebAuthnMode,
    toPasskeyValidator,
    toWebAuthnKey
} from "@zerodev/passkey-validator"
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants"
import React, { useEffect, useState } from "react"
import { createPublicClient, http, parseAbi, encodeFunctionData, Address, Client, Transport, Prettify, Hash, Chain, concat, toFunctionSelector, encodeAbiParameters, parseAbiParameters } from "viem"
import { lineaSepolia } from "viem/chains"
import { sendUserOperation, SmartAccount } from "viem/account-abstraction"
import { parseAccount } from "viem/accounts"
import { getAction } from "viem/utils"

const CHAIN = lineaSepolia
// @dev add your ZERODEV_PROJECT_ID, ZERODEV_RPC_URL and PASSKEY_SERVER_URL here
const PASSKEY_SERVER_URL = ''
const ZERODEV_RPC_URL = ""
const entryPoint = getEntryPoint("0.7")

const contractAddress = "0x34bE7f35132E97915633BC1fc020364EA5134863"
const contractABI = parseAbi([
    "function mint(address _to) public",
    "function balanceOf(address owner) external view returns (uint256 balance)"
])

const publicClient = createPublicClient({
    transport: http(),
    chain: CHAIN
})

let kernelAccount: any
let kernelClient: any

let guardianAccount: any
let guardianClient: any
let newPasskeyValidator: any
const CALLER_HOOK = "0x990a9FC8189D96d59E3cE98bd87F42135a24a30E";
const RECOVERY_ACTION_ADDRESS = "0xe884C2868CC82c16177eC73a93f7D9E6F3A5DC6E"
const ACTION_MODULE_TYPE = 3;
const recoveryExecutorFunction =
  "function doRecovery(address _validator, bytes calldata _data)";

const installModuleFunction = "function installModule(uint256 _type, address _module, bytes calldata _initData)"

type RegisterGuardianParameters = {
    guardian: Address;
    account?: SmartAccount;
}

export async function registerGuardian<
    account extends SmartAccount | undefined,
    chain extends Chain | undefined,
>(
    client: Client<Transport, chain, account>,
    args: Prettify<RegisterGuardianParameters>
): Promise<Hash> {
  const { guardian, account : account_ = client.account } = args
  if (!account_)
      throw new AccountNotFoundError()

  const account = parseAccount(account_) as SmartAccount

  return await getAction(
    client,
    sendUserOperation,
    "sendUserOperation"
  )({
    account,
    callData :encodeFunctionData({
      abi: parseAbi([installModuleFunction]),
      functionName: "installModule",
      args: [
        BigInt(ACTION_MODULE_TYPE),
        RECOVERY_ACTION_ADDRESS,
        concat(
          [
            toFunctionSelector(parseAbi([recoveryExecutorFunction])[0]) as `0x${string}`,
            CALLER_HOOK as `0x${string}`,
            encodeAbiParameters(
              parseAbiParameters('bytes selectorData, bytes hookData'),
              [
                "0xff" as `0x${string}`, // selectorData, use delegatecall
                concat(
                  [
                    "0xff", // flag to install hook
                    encodeAbiParameters(
                      parseAbiParameters('address[] guardians'),
                      [
                        [
                          guardian,
                        ],
                      ]
                    ),
                  ],
                ),
              ]
            ),
          ]
        ),
      ],
    }),
  })

}

type RecoveryParameters = {
    targetAccount: Address;
    guardian: SmartAccount;
    newSigner: KernelValidator;
}
  
  export async function recoverAccount<
    account extends SmartAccount | undefined,
    chain extends Chain | undefined,
  >(
    client: Client<Transport, chain, account>,
    args: Prettify<RecoveryParameters>
  ) {
    const { targetAccount, guardian, newSigner } = args
  
    return await getAction(
      client,
      sendUserOperation,
      "sendUserOperation"
    )({
      account: guardian,
      calls: [
        {
          to: targetAccount,
          data: encodeFunctionData({
            abi: parseAbi([recoveryExecutorFunction]),
            functionName: "doRecovery",
            args: [newSigner.address, await newSigner.getEnableData()],
          }),
        },
      ],
      callGasLimit: BigInt(1000000),
    })
  }
  
export default function Home() {
    const [mounted, setMounted] = useState(false)
    const [username, setUsername] = useState("")
    const [accountAddress, setAccountAddress] = useState("")
    const [isKernelClientReady, setIsKernelClientReady] = useState(false)
    const [isGuardianClientReady, setIsGuardianClientReady] = useState(false)
    const [isRegistering, setIsRegistering] = useState(false)
    const [isRegisteringGuardian, setIsRegisteringGuardian] = useState(false)
    const [guardianAccountAddress, setGuardianAccountAddress] = useState("")
    const [isLoggingIn, setIsLoggingIn] = useState(false)
    const [isLoggingInGuardian, setIsLoggingInGuardian] = useState(false)
    const [isSendingUserOp, setIsSendingUserOp] = useState(false)
    const [userOpHash, setUserOpHash] = useState("")
    const [userOpStatus, setUserOpStatus] = useState("")
    const [guardianName, setGuardianName] = useState("")
    const [newUsername, setNewUsername] = useState("")
    const createAccountAndClient = async (passkeyValidator: any) => {
        kernelAccount = await createKernelAccount(publicClient, {
            entryPoint,
            plugins: {
                sudo: passkeyValidator
            },
            kernelVersion: KERNEL_V3_1
        })

        console.log("Kernel account created: ", kernelAccount.address)

        kernelClient = createKernelAccountClient({
            account: kernelAccount,
            chain: CHAIN,
            bundlerTransport: http(ZERODEV_RPC_URL),
            paymaster: {
                getPaymasterData: async (userOperation) => {
                    const zeroDevPaymaster = await createZeroDevPaymasterClient(
                        {
                            chain: CHAIN,
                            transport: http(ZERODEV_RPC_URL),
                        }
                    )
                    return zeroDevPaymaster.sponsorUserOperation({
                        userOperation,
                    })
                }
            }
        })

        setIsKernelClientReady(true)
        setAccountAddress(kernelAccount.address)
    }

    // Function to be called when "Register" is clicked
    const handleRegister = async () => {
        setIsRegistering(true)

        const webAuthnKey = await toWebAuthnKey({
            passkeyName: username,
            passkeyServerUrl: PASSKEY_SERVER_URL,
            mode: WebAuthnMode.Register,
            passkeyServerHeaders: {}
        })

        const passkeyValidator = await toPasskeyValidator(publicClient, {
            webAuthnKey,
            entryPoint,
            kernelVersion: KERNEL_V3_1,
            validatorContractVersion: PasskeyValidatorContractVersion.V0_0_2
        })

        await createAccountAndClient(passkeyValidator)

        setIsRegistering(false)
        window.alert("Register done.  Try sending UserOps.")
    }

    const handleLogin = async () => {
        setIsLoggingIn(true)

        const webAuthnKey = await toWebAuthnKey({
            passkeyName: username,
            passkeyServerUrl: PASSKEY_SERVER_URL,
            mode: WebAuthnMode.Login,
            passkeyServerHeaders: {}
        })

        const passkeyValidator = await toPasskeyValidator(publicClient, {
            webAuthnKey,
            entryPoint,
            kernelVersion: KERNEL_V3_1,
            validatorContractVersion: PasskeyValidatorContractVersion.V0_0_2
        })

        await createAccountAndClient(passkeyValidator)

        setIsLoggingIn(false)
        window.alert("Login done.  Try sending UserOps.")
    }

    const handleGuardianLogin = async () => {
        setIsLoggingInGuardian(true)

        const webAuthnKey = await toWebAuthnKey({
            passkeyName: guardianName,
            passkeyServerUrl: PASSKEY_SERVER_URL,
            mode: WebAuthnMode.Login,
            passkeyServerHeaders: {}
        })

        const guardianPasskeyValidator = await toPasskeyValidator(publicClient, {
            webAuthnKey,
            entryPoint,
            kernelVersion: KERNEL_V3_1,
            validatorContractVersion: PasskeyValidatorContractVersion.V0_0_2
        })

        guardianAccount = await createKernelAccount(publicClient, {
            entryPoint,
            plugins: {
                sudo: guardianPasskeyValidator
            },
            kernelVersion: KERNEL_V3_1
        })

        guardianClient = createKernelAccountClient({
            account: guardianAccount,
            chain: CHAIN,
            bundlerTransport: http(ZERODEV_RPC_URL),
            paymaster: {
                getPaymasterData: async (userOperation) => {
                    const zeroDevPaymaster = await createZeroDevPaymasterClient(
                        {
                            chain: CHAIN,
                            transport: http(ZERODEV_RPC_URL),
                        }
                    )
                    return zeroDevPaymaster.sponsorUserOperation({
                        userOperation,
                    })
                }
            }
        })

        setIsGuardianClientReady(true)
        setIsLoggingInGuardian(false)
        setGuardianAccountAddress(guardianAccount.address)
    }

    const handleRecoverAccount = async () => {
        setIsSendingUserOp(true)
        setUserOpStatus("Sending UserOp...")
        const webAuthnKey = await toWebAuthnKey({
            passkeyName: newUsername,
            passkeyServerUrl: PASSKEY_SERVER_URL,
            mode: WebAuthnMode.Register,
            passkeyServerHeaders: {}
        })

        newPasskeyValidator = await toPasskeyValidator(publicClient, {
            webAuthnKey,
            entryPoint,
            kernelVersion: KERNEL_V3_1,
            validatorContractVersion: PasskeyValidatorContractVersion.V0_0_2
        })

        const userOpHash = await recoverAccount(guardianClient, {
            targetAccount: kernelAccount.address,
            guardian: guardianAccount,
            newSigner: newPasskeyValidator
        })
        setUserOpHash(userOpHash)
        setUserOpStatus(`Recover Done : ${userOpHash}`)
        setIsSendingUserOp(false)
    }

    const handleRegisterGuardian = async () => {
        setIsSendingUserOp(true)
        setUserOpStatus("Sending UserOp...")
        setIsRegisteringGuardian(true)
 
        const userOpHash = await registerGuardian(kernelClient, {
            guardian: guardianAccount.address
        })
        setUserOpHash(userOpHash)
        setUserOpStatus(`Register Guardian Done : ${userOpHash}`)
        setIsSendingUserOp(false)
        setIsRegisteringGuardian(false)
    }
    
    // Function to be called when "Login" is clicked
    const handleSendUserOp = async () => {
        setIsSendingUserOp(true)
        setUserOpStatus("Sending UserOp...")


        const newKernelAccount = await createKernelAccount(publicClient, {
            entryPoint,
            plugins: {
                sudo: newPasskeyValidator
            },
            kernelVersion: KERNEL_V3_1
        })

        const newKernelClient = createKernelAccountClient({
            account: newKernelAccount,
            chain: CHAIN,
            bundlerTransport: http(ZERODEV_RPC_URL),
            paymaster: {
                getPaymasterData: async (userOperation) => {
                    const zeroDevPaymaster = await createZeroDevPaymasterClient(
                        {
                            chain: CHAIN,
                            transport: http(ZERODEV_RPC_URL),
                        }
                    )
                    return zeroDevPaymaster.sponsorUserOperation({
                        userOperation,
                    })
                }
            }
        })
        

        const userOpHash = await newKernelClient.sendUserOperation({
            callData: await kernelAccount.encodeCalls([
                {
                    to: contractAddress,
                    value: BigInt(0),
                    data: encodeFunctionData({
                        abi: contractABI,
                        functionName: "mint",
                        args: [kernelAccount.address]
                    })
                }
            ])
        })

        setUserOpHash(userOpHash)

        await kernelClient.waitForUserOperationReceipt({
            hash: userOpHash
        })

        // Update the message based on the count of UserOps
        const userOpMessage = `UserOp completed : ${userOpHash}`

        setUserOpStatus(userOpMessage)
        setIsSendingUserOp(false)
    }

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) return <></>

    // Spinner component for visual feedback during loading states
    const Spinner = () => (
        <svg
            className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
        >
            <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
            ></circle>
            <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
        </svg>
    )

    return (
        <main className="flex items-center justify-center min-h-screen px-4 py-24">
            <div className="w-full max-w-lg mx-auto">
                <h1 className="text-4xl font-semibold text-center mb-12">
                    ZeroDev Passkeys Demo
                </h1>

                <div className="space-y-4">
                    {/* Account Address Label */}
                    {accountAddress && (
                        <div className="text-center mb-4">
                            Account address:{" "}
                            <a
                                href={`https://jiffyscan.xyz/account/${accountAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700"
                            >
                                {" "}
                                {accountAddress}{" "}
                            </a>
                        </div>
                    )}

                    {guardianAccountAddress && (
                        <div className="text-center mb-4">
                            Guardian address:{" "}
                            <a
                                href={`https://jiffyscan.xyz/account/${guardianAccountAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700"
                            >
                                {" "}
                                {guardianAccountAddress}{" "}
                            </a>
                        </div>
                    )}

                    {/* Input Box */}

                    {/* Register and Login Buttons */}
                    <div className="flex flex-col sm:flex-row sm:space-x-4">                   
                         <input
                        type="text"
                        placeholder="Your username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="p-2 border border-gray-300 rounded-lg w-full"
                    />

                        {/* Register Button */}
                        <button
                            onClick={handleRegister}
                            disabled={isRegistering || isLoggingIn}
                            className="flex justify-center items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 w-full"
                        >
                            {isRegistering ? <Spinner /> : "Register"}
                        </button>

                    </div>
                    {/* Login Button */}
                    <button
                        onClick={handleLogin}
                        disabled={isLoggingIn || isRegistering}
                        className="mt-2 sm:mt-0 flex justify-center items-center px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 w-full"
                    >
                        {isLoggingIn ? <Spinner /> : "Login"}
                    </button>

                    {/* Register and Login Buttons */}
                    <div className="flex flex-col sm:flex-row sm:space-x-4">
                        {/* Login Button */}
                        {/* Send UserOp to register guardian */}
                        {/* <input
                            type="text"
                            placeholder="Guardian Username"
                            value={guardianName}
                            onChange={(e) => setGuardianName(e.target.value)}
                            className="p-2 border border-gray-300 rounded-lg w-full"
                        /> */}
                        <button
                            onClick={handleGuardianLogin}
                            disabled={isLoggingInGuardian || isRegisteringGuardian}
                            className="mt-2 sm:mt-0 flex justify-center items-center px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 w-full"
                        >
                            {isLoggingInGuardian ? <Spinner /> : "Guardian Login"}
                        </button>
                    </div>
                    {/* Register Button */}
                    <button
                        onClick={handleRegisterGuardian}
                        disabled={isRegisteringGuardian || isLoggingInGuardian || !isGuardianClientReady || !isKernelClientReady}
                        className="flex justify-center items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 w-full"
                    >
                        {isRegisteringGuardian ? <Spinner /> : "Set Guardian"}
                    </button>

                    {/* Send UserOp to recover account */}
                    {/* Input Box */}

                    <div className="flex flex-col sm:flex-row sm:space-x-4">
                        <input
                            type="text"
                            placeholder="New Username"
                            value={newUsername}
                            onChange={(e) => setNewUsername(e.target.value)}
                            className="p-2 border border-gray-300 rounded-lg w-full"
                        />

                        <button
                            onClick={handleRecoverAccount}
                            disabled={!isGuardianClientReady || isSendingUserOp || !isKernelClientReady}
                            className={`px-4 py-2 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 flex justify-center items-center w-full ${
                                isGuardianClientReady && !isSendingUserOp && isKernelClientReady
                                    ? "bg-green-500 hover:bg-green-700 focus:ring-green-500"
                                    : "bg-gray-500"
                            }`}
                        >
                            Recover Account
                        </button>
                    </div>
                    
                    <button
                        onClick={handleSendUserOp}
                        disabled={!isKernelClientReady || isSendingUserOp}
                        className={`px-4 py-2 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 flex justify-center items-center w-full ${
                            isKernelClientReady && !isSendingUserOp
                                ? "bg-green-500 hover:bg-green-700 focus:ring-green-500"
                                : "bg-gray-500"
                        }`}
                    >
                        Send UserOp
                    </button>
                    {userOpHash && (
                        <div
                            className="mt-4"
                            dangerouslySetInnerHTML={{
                                __html: userOpStatus
                            }}
                        />
                    )}
                </div>
            </div>
        </main>
    )
}