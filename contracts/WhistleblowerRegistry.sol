// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[3] calldata _pubSignals
    ) external view returns (bool);
}

contract WhistleblowerRegistry is AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    uint256 public constant DEFAULT_ORG_ID = 0;
    bytes32 public constant SUPER_ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    error UnknownMerkleRoot();
    error NullifierAlreadyUsed();
    error InvalidCategory();
    error InvalidZKProof();
    error RootAlreadyExists();
    error RootDoesNotExist();
    error ReportDoesNotExist();
    error OrganizationAlreadyExists();
    error OrganizationDoesNotExist();
    error OrganizationInactive();
    error UnauthorizedOrgAdmin(uint256 orgId, address account);
    error InvalidOrgAdminAccount();
    error CannotModifySuperAdmin(address account);
    error OrgAdminAlreadyGranted(uint256 orgId, address account);
    error OrgAdminAlreadyRevoked(uint256 orgId, address account);

    IGroth16Verifier public immutable verifier;

    struct Organization {
        string name;
        bool active;
        uint256 createdAt;
    }

    mapping(uint256 => bool) public roots;
    mapping(uint256 => bool) public usedNullifiers;
    mapping(uint256 => Organization) private organizations;
    mapping(uint256 => bool) public organizationExists;
    mapping(uint256 => mapping(uint256 => bool)) public orgRoots;
    mapping(uint256 => mapping(uint256 => bool)) public orgUsedNullifiers;
    mapping(uint256 => mapping(address => bool)) public orgAdmins;
    mapping(uint256 => uint256[]) private orgReportIds;
    mapping(uint256 => uint256) public reportOrgId;

    struct Report {
        uint256 nullifierHash;
        uint256 merkleRoot;
        uint256 timestamp;
        uint8 category;
        bytes encryptedCID;
    }

    Report[] public reports;

    event ReportSubmitted(
        uint256 indexed reportId,
        uint256 indexed nullifierHash,
        bytes encryptedCID,
        uint8 category,
        uint256 timestamp
    );
    event ReportSubmittedForOrg(
        uint256 indexed reportId,
        uint256 indexed orgId,
        uint256 indexed nullifierHash,
        bytes encryptedCID,
        uint8 category,
        uint256 timestamp
    );
    event OrganizationCreated(
        uint256 indexed orgId,
        string name,
        uint256 timestamp
    );
    event OrganizationStatusUpdated(
        uint256 indexed orgId,
        bool active,
        uint256 timestamp
    );
    event OrgAdminGranted(
        uint256 indexed orgId,
        address indexed account,
        address indexed grantedBy
    );
    event OrgAdminRevoked(
        uint256 indexed orgId,
        address indexed account,
        address indexed revokedBy
    );
    event RootAdded(uint256 indexed root);
    event RootAddedForOrg(uint256 indexed orgId, uint256 indexed root);
    event RootRevoked(uint256 indexed root);
    event RootRevokedForOrg(uint256 indexed orgId, uint256 indexed root);

    enum ConsensusStatus {
        PENDING_REVIEW,
        APPROVED,
        REJECTED,
        ESCALATED,
        TIMEOUT
    }

    mapping(uint256 => address[]) public reportAssignedAdmins;
    mapping(uint256 => mapping(address => bool)) public reportAdminAssigned;

    mapping(uint256 => mapping(address => uint8)) public adminVotes;
    mapping(uint256 => uint256) public reportApproveCount;
    mapping(uint256 => uint256) public reportRejectCount;
    mapping(uint256 => uint256) public reportEscalateCount;
    mapping(uint256 => ConsensusStatus) public reportConsensusStatus;
    mapping(uint256 => bytes32) public reportConsensusCommitment;

    event ReportAssignedToAdmins(
        uint256 indexed reportId,
        address[] assignedAdmins,
        uint256 timestamp
    );

    event AdminVoted(
        uint256 indexed reportId,
        address indexed admin,
        uint8 vote,
        uint256 timestamp
    );

    event ReportConsensusFinalized(
        uint256 indexed reportId,
        ConsensusStatus status,
        uint256 timestamp
    );

    modifier onlyOrgAdmin(uint256 _orgId) {
        if (!isOrgAdmin(_orgId, msg.sender)) {
            revert UnauthorizedOrgAdmin(_orgId, msg.sender);
        }
        _;
    }

    constructor(address _verifier) {
        _grantRole(SUPER_ADMIN_ROLE, msg.sender);

        verifier = IGroth16Verifier(_verifier);
        organizationExists[DEFAULT_ORG_ID] = true;
        organizations[DEFAULT_ORG_ID] = Organization({
            name: "Default",
            active: true,
            createdAt: block.timestamp
        });
        orgAdmins[DEFAULT_ORG_ID][msg.sender] = true;

        emit OrganizationCreated(DEFAULT_ORG_ID, "Default", block.timestamp);
        emit OrgAdminGranted(DEFAULT_ORG_ID, msg.sender, msg.sender);
    }

    function orgAdminRole(uint256 _orgId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("ORG_ADMIN_ROLE", _orgId));
    }

    function isOrgAdmin(
        uint256 _orgId,
        address _account
    ) public view returns (bool) {
        return
            hasRole(SUPER_ADMIN_ROLE, _account) ||
            orgAdmins[_orgId][_account] ||
            hasRole(orgAdminRole(_orgId), _account);
    }

    function grantOrgAdmin(
        uint256 _orgId,
        address _account
    ) external onlyOrgAdmin(_orgId) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        if (_account == address(0)) revert InvalidOrgAdminAccount();
        if (hasRole(SUPER_ADMIN_ROLE, _account))
            revert CannotModifySuperAdmin(_account);
        if (isOrgAdmin(_orgId, _account))
            revert OrgAdminAlreadyGranted(_orgId, _account);

        orgAdmins[_orgId][_account] = true;
        _grantRole(orgAdminRole(_orgId), _account);

        emit OrgAdminGranted(_orgId, _account, msg.sender);
    }

    function revokeOrgAdmin(
        uint256 _orgId,
        address _account
    ) external onlyOrgAdmin(_orgId) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        if (_account == address(0)) revert InvalidOrgAdminAccount();
        if (hasRole(SUPER_ADMIN_ROLE, _account))
            revert CannotModifySuperAdmin(_account);
        if (!isOrgAdmin(_orgId, _account))
            revert OrgAdminAlreadyRevoked(_orgId, _account);

        orgAdmins[_orgId][_account] = false;
        if (hasRole(orgAdminRole(_orgId), _account)) {
            _revokeRole(orgAdminRole(_orgId), _account);
        }

        emit OrgAdminRevoked(_orgId, _account, msg.sender);
    }

    function addRoot(uint256 _root) external onlyOrgAdmin(DEFAULT_ORG_ID) {
        addRootForOrg(DEFAULT_ORG_ID, _root);
    }

    function revokeRoot(uint256 _root) external onlyOrgAdmin(DEFAULT_ORG_ID) {
        revokeRootForOrg(DEFAULT_ORG_ID, _root);
    }

    function createOrganization(
        uint256 _orgId,
        string calldata _name
    ) external onlyRole(SUPER_ADMIN_ROLE) {
        if (organizationExists[_orgId]) revert OrganizationAlreadyExists();
        organizationExists[_orgId] = true;
        organizations[_orgId] = Organization({
            name: _name,
            active: true,
            createdAt: block.timestamp
        });

        orgAdmins[_orgId][msg.sender] = true;
        _grantRole(orgAdminRole(_orgId), msg.sender);

        emit OrganizationCreated(_orgId, _name, block.timestamp);
        emit OrgAdminGranted(_orgId, msg.sender, msg.sender);
    }

    function setOrganizationActive(
        uint256 _orgId,
        bool _active
    ) external onlyOrgAdmin(_orgId) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        organizations[_orgId].active = _active;
        emit OrganizationStatusUpdated(_orgId, _active, block.timestamp);
    }

    function getOrganization(
        uint256 _orgId
    ) external view returns (Organization memory) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        return organizations[_orgId];
    }

    function addRootForOrg(
        uint256 _orgId,
        uint256 _root
    ) public onlyOrgAdmin(_orgId) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        if (!organizations[_orgId].active) revert OrganizationInactive();
        if (orgRoots[_orgId][_root]) revert RootAlreadyExists();

        orgRoots[_orgId][_root] = true;
        if (_orgId == DEFAULT_ORG_ID) {
            roots[_root] = true;
            emit RootAdded(_root);
        }

        emit RootAddedForOrg(_orgId, _root);
    }

    function revokeRootForOrg(
        uint256 _orgId,
        uint256 _root
    ) public onlyOrgAdmin(_orgId) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        if (!orgRoots[_orgId][_root]) revert RootDoesNotExist();

        orgRoots[_orgId][_root] = false;
        if (_orgId == DEFAULT_ORG_ID) {
            roots[_root] = false;
            emit RootRevoked(_root);
        }

        emit RootRevokedForOrg(_orgId, _root);
    }

    function submitReport(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint256 _root,
        uint256 _nullifierHash,
        uint256 _externalNullifier,
        bytes calldata _encryptedCID,
        uint8 _category
    ) external {
        submitReportForOrg(
            DEFAULT_ORG_ID,
            _pA,
            _pB,
            _pC,
            _root,
            _nullifierHash,
            _externalNullifier,
            _encryptedCID,
            _category
        );
    }

    function submitReportForOrg(
        uint256 _orgId,
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint256 _root,
        uint256 _nullifierHash,
        uint256 _externalNullifier,
        bytes calldata _encryptedCID,
        uint8 _category
    ) public {
        // Cheap checks first, expensive proof verification last
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        if (!organizations[_orgId].active) revert OrganizationInactive();
        if (!orgRoots[_orgId][_root]) revert UnknownMerkleRoot();
        if (orgUsedNullifiers[_orgId][_nullifierHash])
            revert NullifierAlreadyUsed();
        if (_category > 3) revert InvalidCategory();

        // Expensive proof verification last (fail fast on invalid inputs)
        uint[3] memory pubSignals = [_root, _nullifierHash, _externalNullifier];
        if (!verifier.verifyProof(_pA, _pB, _pC, pubSignals))
            revert InvalidZKProof();

        orgUsedNullifiers[_orgId][_nullifierHash] = true;
        if (_orgId == DEFAULT_ORG_ID) {
            usedNullifiers[_nullifierHash] = true;
        }

        uint256 reportId = reports.length;
        reports.push(
            Report({
                nullifierHash: _nullifierHash,
                merkleRoot: _root,
                timestamp: block.timestamp,
                category: _category,
                encryptedCID: _encryptedCID
            })
        );
        reportOrgId[reportId] = _orgId;
        orgReportIds[_orgId].push(reportId);

        emit ReportSubmitted(
            reportId,
            _nullifierHash,
            _encryptedCID,
            _category,
            block.timestamp
        );
        emit ReportSubmittedForOrg(
            reportId,
            _orgId,
            _nullifierHash,
            _encryptedCID,
            _category,
            block.timestamp
        );
    }

    function getReport(
        uint256 _reportId
    ) external view returns (Report memory) {
        if (_reportId >= reports.length) revert ReportDoesNotExist();
        return reports[_reportId];
    }

    function getReportCount() external view returns (uint256) {
        return reports.length;
    }

    function getOrgReportCount(uint256 _orgId) external view returns (uint256) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        return orgReportIds[_orgId].length;
    }

    function getOrgReportIdAt(
        uint256 _orgId,
        uint256 _index
    ) external view returns (uint256) {
        if (!organizationExists[_orgId]) revert OrganizationDoesNotExist();
        if (_index >= orgReportIds[_orgId].length) revert ReportDoesNotExist();
        return orgReportIds[_orgId][_index];
    }

    function assignReportToAdmins(uint256 _reportId, address[] calldata _admins) external {
        if (_reportId >= reports.length) revert ReportDoesNotExist();
        uint256 orgId = reportOrgId[_reportId];
        if (!isOrgAdmin(orgId, msg.sender)) revert UnauthorizedOrgAdmin(orgId, msg.sender);

        // clear previous assignments
        address[] storage prev = reportAssignedAdmins[_reportId];
        for (uint256 i = 0; i < prev.length; i++) {
            reportAdminAssigned[_reportId][prev[i]] = false;
        }
        delete reportAssignedAdmins[_reportId];

        for (uint256 i = 0; i < _admins.length; i++) {
            address a = _admins[i];
            if (a == address(0)) continue;
            if (!reportAdminAssigned[_reportId][a]) {
                reportAssignedAdmins[_reportId].push(a);
                reportAdminAssigned[_reportId][a] = true;
            }
        }

        reportConsensusStatus[_reportId] = ConsensusStatus.PENDING_REVIEW;
        emit ReportAssignedToAdmins(_reportId, _admins, block.timestamp);
    }

    function isAssignedAdmin(uint256 _reportId, address _admin) external view returns (bool) {
        return reportAdminAssigned[_reportId][_admin];
    }

    function adminVote(uint256 _reportId, uint8 _vote) external {
        if (_reportId >= reports.length) revert ReportDoesNotExist();
        uint256 orgId = reportOrgId[_reportId];
        if (!isOrgAdmin(orgId, msg.sender)) revert UnauthorizedOrgAdmin(orgId, msg.sender);
        if (!reportAdminAssigned[_reportId][msg.sender]) revert UnauthorizedOrgAdmin(orgId, msg.sender);
        if (adminVotes[_reportId][msg.sender] != 0) revert();
        if (_vote < 1 || _vote > 3) revert();

        adminVotes[_reportId][msg.sender] = _vote;
        if (_vote == 1) {
            reportApproveCount[_reportId]++;
        } else if (_vote == 2) {
            reportRejectCount[_reportId]++;
        } else if (_vote == 3) {
            reportEscalateCount[_reportId]++;
        }

        emit AdminVoted(_reportId, msg.sender, _vote, block.timestamp);
    }

    function finalizeConsensus(uint256 _reportId) external {
        if (_reportId >= reports.length) revert ReportDoesNotExist();
        uint256 orgId = reportOrgId[_reportId];
        if (!isOrgAdmin(orgId, msg.sender)) revert UnauthorizedOrgAdmin(orgId, msg.sender);

        if (reportConsensusStatus[_reportId] != ConsensusStatus.PENDING_REVIEW) {
            return;
        }

        uint256 assigned = reportAssignedAdmins[_reportId].length;
        uint256 approves = reportApproveCount[_reportId];
        uint256 rejects = reportRejectCount[_reportId];
        uint256 escalates = reportEscalateCount[_reportId];

        ConsensusStatus status = ConsensusStatus.PENDING_REVIEW;
        if (assigned == 0) {
            status = ConsensusStatus.PENDING_REVIEW;
        } else if (approves * 3 > assigned * 2) {
            status = ConsensusStatus.APPROVED;
        } else if (rejects * 3 > assigned * 2) {
            status = ConsensusStatus.REJECTED;
        } else if (escalates * 3 > assigned * 2) {
            status = ConsensusStatus.ESCALATED;
        }

        reportConsensusStatus[_reportId] = status;
        emit ReportConsensusFinalized(_reportId, status, block.timestamp);
    }

    // Anchor an off-chain consensus commitment with signatures from assigned admins.
    // commitment = keccak256(abi.encodePacked(reportId, decision,uint256 timestamp, chainId))
    // decision: 1=APPROVED, 2=REJECTED, 3=ESCALATED
    function anchorConsensus(
        uint256 _reportId,
        uint8 _decision,
        uint256 _timestamp,
        bytes32 _commitment,
        address[] calldata _signers,
        bytes[] calldata _signatures
    ) external {
        if (_reportId >= reports.length) revert ReportDoesNotExist();
        if (_signers.length != _signatures.length) revert();
        if (reportConsensusStatus[_reportId] != ConsensusStatus.PENDING_REVIEW) revert();

        uint256 orgId = reportOrgId[_reportId];
        if (!organizationExists[orgId]) revert OrganizationDoesNotExist();

        uint256 assigned = reportAssignedAdmins[_reportId].length;
        if (assigned == 0) revert();

        // verify commitment
        bytes32 expected = keccak256(abi.encodePacked(_reportId, _decision, _timestamp, block.chainid));
        if (expected != _commitment) revert();
        if (_timestamp > block.timestamp) revert();
        if (block.timestamp - _timestamp > 30 days) revert();

        // verify signatures and signers
        uint256 valid = 0;
        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            bytes memory sig = _signatures[i];
            // recover signer from signature over the eth-signed commitment
            bytes32 ethHash = _commitment.toEthSignedMessageHash();
            address recovered = ECDSA.recover(ethHash, sig);
            if (recovered != signer) continue;
            if (!reportAdminAssigned[_reportId][signer]) continue;
            if (!isOrgAdmin(orgId, signer)) continue;

            // ensure uniqueness of signer in this batch
            bool duplicate = false;
            for (uint256 j = 0; j < i; j++) {
                if (_signers[j] == signer) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) continue;

            valid++;
        }

        // require supermajority of assigned admins to have signed
        if (valid * 3 <= assigned * 2) revert();

        // map decision to status
        ConsensusStatus status;
        if (_decision == 1) status = ConsensusStatus.APPROVED;
        else if (_decision == 2) status = ConsensusStatus.REJECTED;
        else if (_decision == 3) status = ConsensusStatus.ESCALATED;
        else revert();

        reportConsensusStatus[_reportId] = status;
        reportConsensusCommitment[_reportId] = _commitment;

        emit ReportConsensusFinalized(_reportId, status, block.timestamp);
    }
}
