pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedWillHandler is ZamaEthereumConfig {
    struct Will {
        string encryptedContent;
        euint32 encryptedTriggerCondition;
        address testator;
        address beneficiary;
        uint256 creationTimestamp;
        uint256 executionTimestamp;
        bool isExecuted;
    }

    mapping(string => Will) private wills;
    string[] private willIds;

    event WillCreated(string indexed willId, address indexed testator);
    event WillExecuted(string indexed willId, address indexed beneficiary);

    modifier onlyBeneficiary(string memory willId) {
        require(msg.sender == wills[willId].beneficiary, "Caller is not beneficiary");
        _;
    }

    constructor() ZamaEthereumConfig() {
    }

    function createWill(
        string calldata willId,
        string calldata encryptedContent,
        externalEuint32 encryptedTriggerCondition,
        bytes calldata inputProof,
        address beneficiary
    ) external {
        require(bytes(wills[willId].encryptedContent).length == 0, "Will already exists");
        require(beneficiary != address(0), "Invalid beneficiary address");

        euint32 encryptedCondition = FHE.fromExternal(encryptedTriggerCondition, inputProof);
        require(FHE.isInitialized(encryptedCondition), "Invalid encrypted condition");

        wills[willId] = Will({
            encryptedContent: encryptedContent,
            encryptedTriggerCondition: encryptedCondition,
            testator: msg.sender,
            beneficiary: beneficiary,
            creationTimestamp: block.timestamp,
            executionTimestamp: 0,
            isExecuted: false
        });

        FHE.allowThis(wills[willId].encryptedTriggerCondition);
        FHE.makePubliclyDecryptable(wills[willId].encryptedTriggerCondition);

        willIds.push(willId);

        emit WillCreated(willId, msg.sender);
    }

    function executeWill(
        string calldata willId,
        bytes memory abiEncodedTriggerValue,
        bytes memory decryptionProof
    ) external onlyBeneficiary(willId) {
        Will storage will = wills[willId];
        require(!will.isExecuted, "Will already executed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(will.encryptedTriggerCondition);

        FHE.checkSignatures(cts, abiEncodedTriggerValue, decryptionProof);

        will.executionTimestamp = block.timestamp;
        will.isExecuted = true;

        emit WillExecuted(willId, msg.sender);
    }

    function getWill(string calldata willId) external view returns (
        string memory encryptedContent,
        address testator,
        address beneficiary,
        uint256 creationTimestamp,
        uint256 executionTimestamp,
        bool isExecuted
    ) {
        Will storage will = wills[willId];
        require(bytes(will.encryptedContent).length > 0, "Will does not exist");

        return (
            will.encryptedContent,
            will.testator,
            will.beneficiary,
            will.creationTimestamp,
            will.executionTimestamp,
            will.isExecuted
        );
    }

    function getWillIds() external view returns (string[] memory) {
        return willIds;
    }

    function verifyTriggerCondition(
        string calldata willId,
        bytes memory abiEncodedTriggerValue,
        bytes memory decryptionProof
    ) external view returns (bool) {
        Will storage will = wills[willId];
        require(bytes(will.encryptedContent).length > 0, "Will does not exist");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(will.encryptedTriggerCondition);

        try FHE.checkSignatures(cts, abiEncodedTriggerValue, decryptionProof) {
            return true;
        } catch {
            return false;
        }
    }

    function updateBeneficiary(string calldata willId, address newBeneficiary) external {
        Will storage will = wills[willId];
        require(msg.sender == will.testator, "Caller is not testator");
        require(!will.isExecuted, "Will already executed");
        require(newBeneficiary != address(0), "Invalid beneficiary address");

        will.beneficiary = newBeneficiary;
    }
}

