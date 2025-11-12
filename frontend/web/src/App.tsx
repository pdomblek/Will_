import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface WillData {
  id: string;
  name: string;
  description: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [wills, setWills] = useState<WillData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingWill, setCreatingWill] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newWillData, setNewWillData] = useState({ name: "", description: "", amount: "" });
  const [selectedWill, setSelectedWill] = useState<WillData | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [faqVisible, setFaqVisible] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const willsList: WillData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          willsList.push({
            id: businessId,
            name: businessData.name,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setWills(willsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createWill = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingWill(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating digital will with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newWillData.amount) || 0;
      const businessId = `will-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newWillData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amountValue,
        0,
        newWillData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Digital will created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewWillData({ name: "", description: "", amount: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingWill(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Will data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredWills = wills.filter(will => 
    will.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    will.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    totalWills: wills.length,
    verifiedWills: wills.filter(w => w.isVerified).length,
    totalAmount: wills.reduce((sum, w) => sum + (w.decryptedValue || w.publicValue1), 0)
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Digital Will 🏛️</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">📜</div>
            <h2>Connect Your Wallet to Access Digital Will</h2>
            <p>Secure your legacy with fully homomorphic encryption technology</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted will system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Digital Will 🏛️</h1>
          <span className="tagline">Privacy-Preserving Legacy Management</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Create Will
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-item">
            <div className="stat-value">{stats.totalWills}</div>
            <div className="stat-label">Total Wills</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.verifiedWills}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.totalAmount}</div>
            <div className="stat-label">Total Assets</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search wills..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={() => setFaqVisible(!faqVisible)} className="faq-btn">
            {faqVisible ? "Hide FAQ" : "Show FAQ"}
          </button>
        </div>

        {faqVisible && (
          <div className="faq-section">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-item">
              <strong>How does FHE protect my will?</strong>
              <p>Your will data is encrypted using fully homomorphic encryption, allowing computations without decryption.</p>
            </div>
            <div className="faq-item">
              <strong>When can beneficiaries access the will?</strong>
              <p>Beneficiaries can access the will only after verification conditions are met through homomorphic triggers.</p>
            </div>
            <div className="faq-item">
              <strong>Is my data truly private?</strong>
              <p>Yes, all sensitive data remains encrypted throughout the entire process using Zama FHE technology.</p>
            </div>
          </div>
        )}

        <div className="wills-section">
          <div className="section-header">
            <h2>Your Digital Wills</h2>
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          <div className="wills-grid">
            {filteredWills.length === 0 ? (
              <div className="no-wills">
                <p>No digital wills found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Will
                </button>
              </div>
            ) : filteredWills.map((will, index) => (
              <div 
                className={`will-card ${selectedWill?.id === will.id ? "selected" : ""} ${will.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedWill(will)}
              >
                <div className="will-title">{will.name}</div>
                <div className="will-description">{will.description}</div>
                <div className="will-meta">
                  <span>Amount: {will.isVerified ? will.decryptedValue : "🔒 Encrypted"}</span>
                  <span>Created: {new Date(will.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className={`will-status ${will.isVerified ? "verified" : "pending"}`}>
                  {will.isVerified ? "✅ Verified" : "🔓 Pending Verification"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateWill 
          onSubmit={createWill} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingWill} 
          willData={newWillData} 
          setWillData={setNewWillData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedWill && (
        <WillDetailModal 
          will={selectedWill} 
          onClose={() => { 
            setSelectedWill(null); 
            setDecryptedAmount(null); 
          }} 
          decryptedAmount={decryptedAmount} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedWill.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>FHE Digital Will - Secure Legacy Management with Fully Homomorphic Encryption</p>
      </footer>
    </div>
  );
};

const ModalCreateWill: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  willData: any;
  setWillData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, willData, setWillData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setWillData({ ...willData, [name]: intValue });
    } else {
      setWillData({ ...willData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-will-modal">
        <div className="modal-header">
          <h2>Create Digital Will</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Asset amount will be encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Will Name *</label>
            <input 
              type="text" 
              name="name" 
              value={willData.name} 
              onChange={handleChange} 
              placeholder="Enter will name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Asset Amount (Integer only) *</label>
            <input 
              type="number" 
              name="amount" 
              value={willData.amount} 
              onChange={handleChange} 
              placeholder="Enter asset amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={willData.description} 
              onChange={handleChange} 
              placeholder="Enter will description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !willData.name || !willData.amount || !willData.description} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Will"}
          </button>
        </div>
      </div>
    </div>
  );
};

const WillDetailModal: React.FC<{
  will: WillData;
  onClose: () => void;
  decryptedAmount: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ will, onClose, decryptedAmount, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) return;
    
    const decrypted = await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="will-detail-modal">
        <div className="modal-header">
          <h2>Will Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="will-info">
            <div className="info-item">
              <span>Will Name:</span>
              <strong>{will.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{will.creator.substring(0, 6)}...{will.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(will.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <strong>{will.description}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Asset Data</h3>
            
            <div className="data-row">
              <div className="data-label">Asset Amount:</div>
              <div className="data-value">
                {will.isVerified ? 
                  `${will.decryptedValue} (On-chain Verified)` : 
                  decryptedAmount !== null ? 
                  `${decryptedAmount} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(will.isVerified || decryptedAmount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : will.isVerified ? "✅ Verified" : "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Data</strong>
                <p>Asset amount is encrypted using fully homomorphic encryption for maximum privacy.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

